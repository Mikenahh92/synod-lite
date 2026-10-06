import fs from "node:fs";
import path from "node:path";
import { type Story, Store } from "./store.ts";
import { type PitbossConfig } from "./config.ts";
import { runPi } from "./runner.ts";
import * as g from "./git.ts";

export interface Ctx { repo: string; cfg: PitbossConfig; store: Store }

const NEWEST = (dir: string, prefix: string): string | null => {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith(".md"));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, files[0]);
};

export function newestSpec(ctx: Ctx, s: Story): string | null {
  const dir = path.join(ctx.repo, s.worktree, ".dev-agents", "specs");
  if (!fs.existsSync(dir)) return null;
  const specs = fs.readdirSync(dir)
    .filter(f => f.endsWith(".md") && !f.startsWith("test-design") && !f.startsWith("research"))
    .sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return specs.length ? path.join(dir, specs[0]) : null;
}

export function parseReviewVerdict(reviewFile: string): "PASS" | "FAIL" | null {
  const txt = fs.readFileSync(reviewFile, "utf8");
  const gateIdx = txt.toLowerCase().indexOf("gate decision");
  const region = gateIdx >= 0 ? txt.slice(gateIdx, gateIdx + 800) : txt;
  if (/\bFAIL\b/.test(region)) return "FAIL"; // FAIL checked first: a "PASS ... FAIL per AC3" still fails
  if (/\bPASS\b/.test(region)) return "PASS";
  return null;
}

function baseName(file: string): string {
  return path.basename(file, ".md");
}

async function phase(ctx: Ctx, s: Story, name: string, prompt: string): Promise<number> {
  const n = (s.log.filter(l => l.phase === name).length + 1);
  const logFile = ctx.store.logFile(s.id, name, n);
  s.log.push({ phase: name, at: new Date().toISOString(), file: path.relative(ctx.repo, logFile) });
  await ctx.store.update(s.id, { log: s.log, phaseStartedAt: new Date().toISOString() });
  const res = await runPi(ctx.cfg, path.join(ctx.repo, s.worktree), prompt, logFile);
  s = ctx.store.get(s.id)!; // re-read (log list may have grown)
  return res.code;
}

export async function advance(ctx: Ctx, storyId: string, force?: "merge"): Promise<Story> {
  let s = ctx.store.get(storyId);
  if (!s) throw new Error(`story ${storyId} not found`);
  const wt = path.join(ctx.repo, s.worktree);

  switch (s.state) {
    case "drafted": {
      await ctx.store.update(s.id, { state: "refining" });
      const code = await phase(ctx, s, "spec", `run the spec workflow for: ${s.title}`);
      s = ctx.store.get(s.id)!;
      const spec = newestSpec(ctx, s);
      if (code === 0 && spec) {
        await ctx.store.update(s.id, { state: "ready_for_user_review", approved: false, error: undefined });
      } else {
        await ctx.store.update(s.id, { state: "failed", error: `spec phase exited ${code}${spec ? "" : " (no spec file produced)"}` });
      }
      return ctx.store.get(s.id)!;
    }

    case "ready_for_user_review": {
      if (!s.approved) throw new Error(`${s.id} is waiting for approval — synod-lite approve ${s.id}`);
      await ctx.store.update(s.id, { state: "in_development" });
      s = ctx.store.get(s.id)!;
      const spec = newestSpec(ctx, s);
      const slug = spec ? baseName(spec) : "";
      const td = await phase(ctx, s, "test-design", `run the test-design workflow for ${spec ? `.dev-agents/specs/${path.basename(spec)}` : "the newest spec"}`);
      let code = td;
      if (td === 0) {
        const feedback = s.retries > 0 && s.lastReview?.verdict === "FAIL"
          ? ` The previous review FAILED — fix per .dev-agents/output/${s.lastReview.file}; this is retry ${s.retries}.`
          : "";
        code = await phase(ctx, s, "implement", `run the implement workflow for ${spec ? `.dev-agents/specs/${path.basename(spec)}` : "the newest spec"}.${feedback}`);
      }
      s = ctx.store.get(s.id)!;
      if (code === 0) {
        await ctx.store.update(s.id, { state: "in_review", error: undefined });
      } else {
        await ctx.store.update(s.id, { state: "failed", error: `develop phase exited ${code} (see logs)` });
      }
      return ctx.store.get(s.id)!;
    }

    case "in_review": {
      const code = await phase(ctx, s, "review", `run the review workflow for the newest spec`);
      s = ctx.store.get(s.id)!;
      const reviewFile = NEWEST(path.join(wt, ".dev-agents", "output"), "review-");
      if (code !== 0 || !reviewFile) {
        await ctx.store.update(s.id, { state: "failed", error: `review phase exited ${code}${reviewFile ? "" : " (no review file produced)"}` });
        return ctx.store.get(s.id)!;
      }
      const verdict = parseReviewVerdict(reviewFile);
      const lastReview = { verdict: verdict ?? "FAIL", file: path.basename(reviewFile), at: new Date().toISOString() };
      if (verdict === "PASS") {
        await ctx.store.update(s.id, { state: "ready_for_merge", lastReview, error: undefined });
      } else if (s.retries < ctx.cfg.maxRetries) {
        await ctx.store.update(s.id, { state: "ready_for_user_review", approved: true, retries: s.retries + 1, lastReview });
      } else {
        await ctx.store.update(s.id, { state: "blocked", lastReview, error: `review FAIL after ${s.retries} retries` });
      }
      return ctx.store.get(s.id)!;
    }

    case "ready_for_merge": {
      if (ctx.cfg.auto !== "full" && force !== "merge") throw new Error(`${s.id} is done — merge manually: synod-lite merge ${s.id}`);
      // fallthrough to merging
    }
    // eslint-disable-next-line no-fallthrough
    case "merging": {
      await ctx.store.update(s.id, { state: "merging" });
      try {
        g.squashMerge(ctx.repo, s.branch, ctx.cfg.trunk, s.id, s.title);
        g.removeWorktree(ctx.repo, s.worktree, s.branch);
        await ctx.store.update(s.id, { state: "done", error: undefined });
      } catch (e: any) {
        await ctx.store.update(s.id, { state: "failed", error: `merge failed: ${e.message}` });
      }
      return ctx.store.get(s.id)!;
    }

    default:
      throw new Error(`${s.id} in state '${s.state}' — nothing to advance`);
  }
}

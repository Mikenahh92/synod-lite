import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, loadConfig, type PitbossConfig } from "./core/config.ts";
import { Store, type Story } from "./core/store.ts";
import { isRunnable } from "./core/store.ts";
import { advance, type Ctx } from "./core/machine.ts";

export interface Daemon {
  port: number;
  stop: () => Promise<void>;
}

export function startDaemon(repoRoot: string, cfg: PitbossConfig): Promise<Daemon> {
  const store = new Store(repoRoot);
  const ctx: Ctx = { repo: repoRoot, cfg, store };
  const running = new Map<string, { startedAt: number; phase: string }>();

  async function tick() {
    const stories = store.stories();
    const activeCount = stories.filter(s => running.has(s.id)).length;
    if (activeCount >= cfg.workers) return;
    const next = stories.find(s =>
      !running.has(s.id) &&
      (s.state === "drafted" || s.state === "in_review" ||
       (s.state === "ready_for_user_review" && s.approved) ||
       (s.state === "ready_for_merge" && cfg.auto === "full")));
    if (!next) return;
    const phase = next.state === "drafted" ? "spec"
      : next.state === "in_review" ? "review"
      : next.state === "ready_for_merge" ? "merge" : "develop";
    running.set(next.id, { startedAt: Date.now(), phase });
    advance(ctx, next.id)
      .catch(e => store.update(next.id, { state: "failed", error: e.message }).catch(() => {}))
      .finally(() => running.delete(next.id));
  }
  const timer = setInterval(tick, 1000);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (req.method === "GET" && url.pathname === "/state") {
      const stories = store.stories();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        stories: stories.map(s => ({ ...s, running: running.has(s.id) })),
        runningIds: [...running.keys()],
        runs: Object.fromEntries(running),
        config: { workers: cfg.workers, maxRetries: cfg.maxRetries, auto: cfg.auto, trunk: cfg.trunk },
        tails: Object.fromEntries(stories.map(s => {
          const last = s.log[s.log.length - 1];
          if (!last) return [s.id, ""];
          const abs = path.join(repoRoot, last.file);
          if (!fs.existsSync(abs)) return [s.id, ""];
          const lines = fs.readFileSync(abs, "utf8").split("\n");
          return [s.id, lines.slice(-40).join("\n")];
        })),
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/stop") {
      res.end(JSON.stringify({ ok: true }));
      setTimeout(() => process.exit(0), 100);
      return;
    }
    if (req.method === "POST" && url.pathname === "/action") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", async () => {
        try {
          const { action, id, args } = JSON.parse(body || "{}");
          const result = await handleAction(ctx, action, id, args ?? {});
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, result }));
        } catch (e: any) {
          console.error("[action-error]", e.stack);
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  return new Promise(resolve => {
    server.listen(cfg.daemonPort, "127.0.0.1", () => {
      resolve({
        port: (server.address() as any).port,
        stop: () => new Promise<void>(done => { clearInterval(timer); server.close(() => done()); }),
      });
    });
  });
}

export async function handleAction(ctx: Ctx, action: string, id?: string, args: Record<string, any> = {}): Promise<any> {
  const { store, cfg, repo } = ctx;
  switch (action) {
    case "new": {
      const title = String(args.title ?? "");
      if (!title.trim()) throw new Error("title required");
      const storyId = await store.nextId();
      const branch = `story/${storyId.toLowerCase()}`;
      const worktree = path.join(cfg.worktreeRoot, storyId.toLowerCase()).split(path.sep).join("/");
      const { createWorktree } = await import("./core/git.ts");
      createWorktree(repo, branch, worktree, cfg.trunk);
      const story: Story = {
        id: storyId, title, state: "drafted", branch, worktree, retries: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        approved: false, log: [],
      };
      await store.add(story);
      return story;
    }
    case "spec": {
      // spec page: read spec + test-design + review from the story worktree; lock = past spec stage
      const st = store.get(id);
      if (!st) throw new Error("story not found: " + id);
      const wt = path.join(repo, st.worktree);
      const specsDir = path.join(wt, ".dev-agents", "specs");
      const outDir = path.join(wt, ".dev-agents", "output");
      const readNewest = (dir, prefix) => {
        try {
          const f = fs.readdirSync(dir).filter(n => n.startsWith(prefix)).sort().pop();
          return f ? fs.readFileSync(path.join(dir, f), "utf8").slice(0, 20000) : null;
        } catch { return null; }
      };
      const LOCKED = ["in_development", "in_review", "ready_for_merge", "merging", "done"];
      return {
        spec: fs.existsSync(specsDir)
          ? fs.readFileSync(path.join(specsDir, (fs.readdirSync(specsDir).filter(n => n.endsWith(".md") && !n.startsWith("test-design")).sort().pop() ?? "")), "utf8").slice(0, 20000)
          : null,
        testDesign: readNewest(specsDir, "test-design"),
        review: st.lastReview ? readNewest(outDir, "review-") : null,
        locked: LOCKED.includes(st.state),
        state: st.state,
      };
    }
    case "chat": {
      // agent chat: pi session with story-state context; may execute non-gate actions
      const message = String(args.message ?? "").slice(0, 2000);
      if (!message.trim()) throw new Error("message required");
      const { runPi } = await import("./core/runner.ts");
      const snap = store.stories().map(({ id, title, state, retries }) => ({ id, title, state, retries }));
      const focus = store.get(String(args.focus ?? ""));
      let focusCtx = "";
      if (focus) {
        const LOCKED = ["in_development", "in_review", "ready_for_merge", "merging", "done"];
        let specEx = null;
        try {
          const dir = path.join(repo, focus.worktree, ".dev-agents", "specs");
          const f = fs.readdirSync(dir).filter(n => n.endsWith(".md") && !n.startsWith("test-design")).sort().pop();
          if (f) specEx = fs.readFileSync(path.join(dir, f), "utf8").slice(0, 1200);
        } catch {}
        let docCtx = "";
        const doc = String(args.doc ?? "");
        if (doc) {
          try {
            const d = doc === "Test design" ? ["specs", "test-design"] : doc === "Review" ? ["output", "review-"] : ["specs", ""];
            const dir = path.join(repo, focus.worktree, ".dev-agents", d[0]);
            const fname = fs.readdirSync(dir).filter(n => n.endsWith(".md") && n.startsWith(d[1])).sort().pop();
            if (fname) docCtx = "\nThe operator is viewing the story's " + doc + " document (" + fname + "):\n" + fs.readFileSync(path.join(dir, fname), "utf8").slice(0, 2500) + "\n";
          } catch {}
        }
        focusCtx = docCtx + "\nThe operator currently has story " + focus.id + " (" + focus.title + ", state " + focus.state + ") in focus.\n"
          + (specEx ? "Its spec (excerpt):\n" + specEx + "\n" : "No spec authored yet.\n")
          + (LOCKED.includes(focus.state)
            ? "This story is past the spec stage: the spec is LOCKED. Do not propose spec edits; advise on progress, reviews, retries, or merging instead."
            : "The spec is still editable (story not yet in development).");
      }
      const sys = [
        "You are the synod-lite assistant, embedded in a story dashboard the operator is looking at.",
        "Current stories (JSON): " + JSON.stringify(snap),
        "Help the operator: explain states, summarise progress, advise next steps. When a diagram or graph would help, render it as ASCII art (monospace-safe).",
        focusCtx,
        "You may end your reply with exactly ONE action line: ACTION: <command>",
        "Allowed actions: ACTION: new \"<title>\"  |  ACTION: retry <id>  |  ACTION: kill <id>",
        "approve and merge are human gates — NEVER issue them; tell the operator to press a/m instead.",
        "Keep replies short (terminal column width). No markdown fences.",
      ].join("\n");
      const log = store.logFile("chat", "chat", 0);
      const r = await runPi(cfg, repo, sys + "\n\nOperator: " + message, log);
      let raw = "";
      try { raw = fs.readFileSync(log, "utf8"); } catch { /* empty */ }
      const m = raw.match(/^ACTION:\s*(.+)$/m);
      let action: string | null = null, actionResult: string | null = null;
      if (m && r.code === 0) {
        action = m[1].trim();
        let ok = false;
        let newM; let retryK;
        if ((newM = action.match(/^new\s+"(.+)"$/))) {
          try { actionResult = (await handleAction(ctx, "new", undefined, { title: newM[1] })).message ?? "story created"; ok = true; }
          catch (e: any) { actionResult = "✗ " + e.message; }
        } else if ((retryK = action.match(/^(retry|kill)\s+(\S+)$/))) {
          try { await handleAction(ctx, retryK[1], retryK[2], {}); actionResult = `${retryK[1]} ${retryK[2]} ✓`; ok = true; }
          catch (e: any) { actionResult = "✗ " + e.message; }
        } else { actionResult = "✗ unsupported action (human gates: approve/merge are yours)"; }
        raw = raw.replace(m[0], "").trimEnd();
      }
      return { reply: raw.split("\n").filter(Boolean).slice(-30).join("\n") || "(no reply)", action, actionResult };
    }
    case "approve": {
      const s = mustGet(store, id!);
      if (s.state !== "ready_for_user_review") throw new Error(`${s.id} is '${s.state}', expected ready_for_user_review`);
      return store.update(s.id, { approved: true });
    }
    case "retry": {
      const s = mustGet(store, id!);
      if (s.state !== "failed" && s.state !== "blocked") throw new Error(`${s.id} is '${s.state}' — only failed/blocked can retry`);
      return store.update(s.id, { state: "ready_for_user_review", approved: true, retries: 0, error: undefined });
    }
    case "kill": {
      const s = mustGet(store, id!);
      if (s.state === "done" || s.state === "cancelled") throw new Error(`${s.id} already ${s.state}`);
      const { removeWorktree } = await import("./core/git.ts");
      if (s.state !== "merging") removeWorktree(repo, s.worktree, s.branch);
      return store.update(s.id, { state: "cancelled" });
    }
    case "merge": {
      const s = mustGet(store, id!);
      if (s.state !== "ready_for_merge") throw new Error(`${s.id} is '${s.state}', expected done`);
      return advance(ctx, s.id, "merge"); // executes merge path
    }
    case "step": {
      const s = mustGet(store, id!);
      return advance(ctx, s.id); // manual single advance (daemon-independent)
    }
    default: throw new Error(`unknown action '${action}'`);
  }
}

function mustGet(store: Store, id: string): Story {
  const s = store.get(id);
  if (!s) throw new Error(`story '${id}' not found`);
  return s;
}

export async function isDaemonUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/state`);
    return res.ok;
  } catch { return false; }
}

export async function callDaemon<T = any>(port: number, action: string, id?: string, args?: Record<string, any>): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}/action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, id, args }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.result;
}

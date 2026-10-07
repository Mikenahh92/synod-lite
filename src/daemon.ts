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
  (ctx as Ctx).running = running;

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
        uiCols: (ctx as Ctx).uiCols ?? null,
        pendingProposal: (ctx as Ctx).pending ?? null,
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
    if (req.method === "POST" && url.pathname === "/ui") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        try {
          const cols = Number(JSON.parse(body || "{}").cols);
          if (Number.isFinite(cols) && cols >= 40 && cols <= 500) (ctx as Ctx).uiCols = Math.floor(cols);
          res.end(JSON.stringify({ ok: true, uiCols: (ctx as Ctx).uiCols }));
        } catch (e: any) {
          res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
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
      const focus = store.get(String(args.focus ?? "")) ?? null;
      const sys = buildChatPrompt(ctx, message, focus, String(args.doc ?? ""));
      const log = store.logFile("chat", "chat", 0);
      const r = await runPi(cfg, repo, sys, log);
      let raw = "";
      try { raw = fs.readFileSync(log, "utf8"); } catch { /* empty */ }
      const m = raw.match(/^ACTION:\s*(.+)$/m);
      let action: string | null = null, actionResult: string | null = null;
      if (m && r.code === 0) {
        action = m[1].trim();
        let ok = false;
        let newM; let retryK; let resetM;
        if ((newM = action.match(/^new\s+"(.+)"$/))) {
          try { actionResult = (await handleAction(ctx, "new", undefined, { title: newM[1] })).message ?? "story created"; ok = true; }
          catch (e: any) { actionResult = "✗ " + e.message; }
        } else if ((retryK = action.match(/^(retry|kill)\s+(\S+)$/))) {
          try { await handleAction(ctx, retryK[1], retryK[2], {}); actionResult = `${retryK[1]} ${retryK[2]} ✓`; ok = true; }
          catch (e: any) { actionResult = "✗ " + e.message; }
        } else if ((resetM = action.match(/^reset\s+(\S+)\s+--to\s+(spec|develop|review|mergeable)(\s+--code)?$/))) {
          // destructive → never executed directly: becomes a proposal the
          // operator must confirm in the dashboard (y)
          ctx.pending = { action: "reset", id: resetM[1], args: { to: resetM[2], code: !!resetM[3] }, at: Date.now() };
          actionResult = `reset ${resetM[1]} → ${resetM[2]}${resetM[3] ? " +code" : ""} proposed — operator must confirm (y)`;
          ok = true;
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
    case "reset": {
      // reset a story to a chosen phase; optionally hard-reset its branch to
      // trunk (--code) discarding all story commits. Human action (CLI/TUI).
      const s = mustGet(store, id!);
      if (ctx.running?.has(s.id)) throw new Error(`${s.id} is running — kill or wait before resetting`);
      if (s.state === "cancelled") throw new Error(`${s.id} was cancelled (worktree removed) — create a new story instead`);
      if (s.state === "done") throw new Error(`${s.id} is done (already merged into ${cfg.trunk}) — reset would not un-merge; create a new story instead`);
      const TO: Record<string, { state: Story["state"]; approved: boolean; retries: number }> = {
        spec: { state: "drafted", approved: false, retries: 0 },
        develop: { state: "in_development", approved: true, retries: 0 },
        review: { state: "in_review", approved: true, retries: 0 },
        mergeable: { state: "ready_for_merge", approved: true, retries: 0 },
      };
      const to = String(args.to ?? "");
      const patch = TO[to];
      if (!patch) throw new Error(`invalid reset target '${to}' — use spec | develop | review | mergeable`);
      if (args.code) {
        const { resetWorktreeToTrunk } = await import("./core/git.ts");
        resetWorktreeToTrunk(repo, s.worktree, cfg.trunk);
      }
      return store.update(s.id, { ...patch, error: undefined });
    }
    case "kill": {
      const s = mustGet(store, id!);
      if (s.state === "done" || s.state === "cancelled") throw new Error(`${s.id} already ${s.state}`);
      const { removeWorktree } = await import("./core/git.ts");
      if (s.state !== "merging") removeWorktree(repo, s.worktree, s.branch);
      return store.update(s.id, { state: "cancelled" });
    }
    case "proposal": {
      // resolve an agent-proposed action: accept executes it, reject drops it
      const p = (ctx as Ctx).pending;
      (ctx as Ctx).pending = undefined;
      if (!p) throw new Error("no pending proposal");
      if (!args.accept) return { resolved: "rejected" };
      return handleAction(ctx, p.action, p.id, p.args ?? {});
    }
    case "merge": {
      const s = mustGet(store, id!);
      if (s.state !== "ready_for_merge") throw new Error(`${s.id} is '${s.state}', expected ready_for_merge`);
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

// ── chat agent context ─────────────────────────────────────────────────────
// Capability principle: the agent sees (at least) what the operator sees on
// the current page — board snapshot with run status, focus story details,
// and the exact viewed document (Spec / Test design / Review / Log tail).
const fmtRun = (r?: { startedAt: number; phase: string }): string => {
  if (!r) return "";
  const sec = Math.max(0, Math.floor((Date.now() - r.startedAt) / 1000));
  return ` [running ${r.phase} workflow, ${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s elapsed]`;
};
const LOCKED_STATES = ["in_development", "in_review", "ready_for_merge", "merging", "done"];

const readNewestIn = (dir: string, prefix: string): string | null => {
  try {
    const f = fs.readdirSync(dir).filter(n => n.startsWith(prefix) && n.endsWith(".md")).sort().pop();
    return f ? fs.readFileSync(path.join(dir, f), "utf8") : null;
  } catch { return null; }
};

export function buildChatPrompt(ctx: Ctx, message: string, focus?: Story | null, doc?: string): string {
  const { store, cfg, repo } = ctx;
  const board = store.stories().map(s =>
    `<story id="${s.id}" state="${s.state}" retries="${s.retries}"` +
    (s.lastReview ? ` review="${s.lastReview.verdict}"` : "") +
    (ctx.running?.get(s.id) ? ` running="${fmtRun(ctx.running.get(s.id)).trim()}"` : "") +
    `>${JSON.stringify(s.title)}</story>`);
  const cols = ctx.uiCols ?? 80;
  const chatW = Math.max(20, Math.floor(cols * 0.36) - 6);
  const docW = Math.max(cols - 8, 40);
  const out: string[] = [
    "<role>You are the synod-lite assistant, embedded in a story dashboard the operator is looking at. Help the operator: explain states, monitor running agents (phase + elapsed are shown per story), summarise progress and reviews, advise next steps.</role>",
    "",
    "<app_guide>",
    "<lifecycle>drafted →(agent: spec)→ ready_for_user_review →[operator approves]→ in_development →(agent: test-design+implement)→ in_review →(agent: review)→ PASS → ready_for_merge →[operator merges]→ done.</lifecycle>",
    "<failure_handling>Review FAIL → automatic re-develop with feedback, up to maxRetries, then blocked. failed/blocked can be retried; cancelled stories are gone.</failure_handling>",
    "<worktrees>One story = one git branch + worktree (story/s-00n). Merge = squash commit into the trunk branch.</worktrees>",
    '<human_gates operator_keys="true">a approve spec · m merge · R reset to a phase (y-confirmed) · K kill (y-confirmed).</human_gates>',
    "<your_actions>new/retry/kill execute immediately (only when explicitly asked). A reset request becomes a PROPOSAL — the operator must confirm it with y in the dashboard; tell them a confirm bar appears.</your_actions>",
    "<tui_keys>↑↓ select · ⏎ open story · ←→ document pages · f text filter · s status filter · n new · c chat · q quit. CLI mirrors all actions (new/list/show/approve/retry/reset/kill/merge/log).</tui_keys>",
    `<config workers="${cfg.workers}" max_retries="${cfg.maxRetries}" auto="${cfg.auto}" trunk="${cfg.trunk}"/>`,
    "</app_guide>",
    "",
    "<format_constraints>",
    `<terminal_columns>${cols}</terminal_columns>`,
    `<chat_pane truncates_at="${chatW}">your chat replies render in a pane that TRUNCATES lines longer than ${chatW} columns — keep every line short.</chat_pane>`,
    `<ascii_art chat_fits="${chatW}" doc_fits="${docW}">only draw ASCII art if every line fits within ${chatW} columns in chat; docs get ${docW} columns — otherwise describe it or put it in a doc.</ascii_art>`,
    "</format_constraints>",
    "",
    "<board>",
    ...board,
    "</board>",
  ];
  if (focus) {
    const last = focus.log[focus.log.length - 1];
    out.push(
      "",
      `<focus_story id="${focus.id}" state="${focus.state}" retries="${focus.retries}" running="${fmtRun(ctx.running?.get(focus.id)).trim()}">`,
      `  ${JSON.stringify(focus.title)}`,
      `  <branch>${focus.branch}</branch>`,
      `  <created>${focus.createdAt}</created>`,
      focus.lastReview ? `  <last_review verdict="${focus.lastReview.verdict}">${focus.lastReview.file}</last_review>` : "  <last_review>none yet</last_review>",
      ...(focus.error ? [`  <error>${focus.error}</error>`] : []),
      `  <phases>${focus.log.map(l => l.phase).join(" → ") || "none yet"}</phases>`,
    );
    let specEx: string | null = null;
    try {
      const dir = path.join(repo, focus.worktree, ".dev-agents", "specs");
      const f = fs.readdirSync(dir).filter(n => n.endsWith(".md") && !n.startsWith("test-design")).sort().pop();
      if (f) specEx = fs.readFileSync(path.join(dir, f), "utf8");
    } catch { /* no spec yet */ }
    if (specEx) out.push('  <spec excerpt_only="true">\n' + specEx.slice(0, 1600) + '\n  </spec>');
    else out.push("  <spec>none authored yet</spec>");
    const d = doc ?? "";
    if (d === "Test design" || d === "Review") {
      const [sub, prefix] = d === "Test design" ? ["specs", "test-design"] : ["output", "review-"];
      const txt = readNewestIn(path.join(repo, focus.worktree, ".dev-agents", sub), prefix);
      if (txt) out.push(`  <viewed_document type="${d}">\n` + txt.slice(0, 2500) + "\n  </viewed_document>");
    } else if (d === "Log") {
      let tail = "";
      if (last) {
        try {
          const abs = path.join(repo, last.file);
          if (fs.existsSync(abs)) tail = fs.readFileSync(abs, "utf8").split("\n").slice(-30).join("\n");
        } catch { /* unreadable */ }
      }
      out.push(`  <viewed_document type="live_log" phase="${last?.phase ?? "none"}" tail_lines="30">\n` + (tail.slice(0, 3000) || "(no log output yet)") + "\n  </viewed_document>");
    } else if (d === "Details") {
      out.push('  <viewed_document type="details">the operator is on the Details page (fields listed above)</viewed_document>');
    }
    out.push(
      LOCKED_STATES.includes(focus.state)
        ? "  <spec_lock>past the spec stage — the spec is LOCKED. Do not propose spec edits; advise on progress, reviews, retries, or merging instead.</spec_lock>"
        : "  <spec_lock>not locked — story not yet in development, spec still editable</spec_lock>",
      "</focus_story>",
    );
  }
  out.push(
    "",
    "<rules>",
    "  <rule>You may end your reply with exactly ONE action line: ACTION: <command></rule>",
    '  <rule critical="true">Only issue an ACTION when the operator explicitly asked you to do it. For questions or status checks, reply with advice only — never act unrequested.</rule>',
    "  <allowed_actions>",
    '    ACTION: new "<title>"  |  ACTION: retry <id>  |  ACTION: kill <id>  |  ACTION: reset <id> --to spec|develop|review|mergeable [--code] (becomes an operator-approved proposal)',
    "  </allowed_actions>",
    "  <forbidden>approve and merge are human gates — NEVER issue them; tell the operator to press a/m instead.</forbidden>",
    "  <style>Keep replies short; every line must fit its pane width (see format_constraints). No markdown fences.</style>",
    "</rules>",
    "",
    "<operator_message>" + message + "</operator_message>",
  );
  return out.join("\n") + "\n";
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

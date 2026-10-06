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
  const running = new Set<string>();

  async function tick() {
    const stories = store.stories();
    const activeCount = stories.filter(s => running.has(s.id)).length;
    if (activeCount >= cfg.workers) return;
    const next = stories.find(s =>
      !running.has(s.id) &&
      (s.state === "created" || s.state === "reviewing" ||
       (s.state === "spec_ready" && s.approved) ||
       (s.state === "done" && cfg.auto === "full")));
    if (!next) return;
    running.add(next.id);
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
        runningIds: [...running],
        config: { workers: cfg.workers, maxRetries: cfg.maxRetries, auto: cfg.auto, trunk: cfg.trunk },
        tails: Object.fromEntries(
          (stories.length ? [stories.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))] : []).map(s => {
            const last = s.log[s.log.length - 1];
            if (!last) return [s.id, ""];
            const abs = path.join(repoRoot, last.file);
            if (!fs.existsSync(abs)) return [s.id, ""];
            const lines = fs.readFileSync(abs, "utf8").split("\n");
            return [s.id, lines.slice(-30).join("\n")];
          })
        ),
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
        id: storyId, title, state: "created", branch, worktree, retries: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        approved: false, log: [],
      };
      await store.add(story);
      return story;
    }
    case "approve": {
      const s = mustGet(store, id!);
      if (s.state !== "spec_ready") throw new Error(`${s.id} is '${s.state}', expected spec_ready`);
      return store.update(s.id, { approved: true });
    }
    case "retry": {
      const s = mustGet(store, id!);
      if (s.state !== "failed" && s.state !== "needs_human") throw new Error(`${s.id} is '${s.state}' — only failed/needs_human can retry`);
      return store.update(s.id, { state: "spec_ready", approved: true, retries: 0, error: undefined });
    }
    case "kill": {
      const s = mustGet(store, id!);
      if (s.state === "merged" || s.state === "killed") throw new Error(`${s.id} already ${s.state}`);
      const { removeWorktree } = await import("./core/git.ts");
      if (s.state !== "merging") removeWorktree(repo, s.worktree, s.branch);
      return store.update(s.id, { state: "killed" });
    }
    case "merge": {
      const s = mustGet(store, id!);
      if (s.state !== "done") throw new Error(`${s.id} is '${s.state}', expected done`);
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

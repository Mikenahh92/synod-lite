#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, loadConfig } from "../src/core/config.ts";
import { Store } from "../src/core/store.ts";
import { isDaemonUp, callDaemon, startDaemon } from "../src/daemon.ts";
import { handleAction } from "../src/daemon.ts";

const HELP = `pitboss — story harness for pi + dev-agents

Usage: pitboss <command> [args]
  new "<title>"        create a story (worktree + branch), spec starts automatically (daemon)
  list                 overview of all stories
  show <id>            story details (state, retries, last review, logs)
  approve <id>         approve the spec — development starts automatically (daemon)
  retry <id>           reset a failed/needs_human story to re-develop (retries reset)
  kill <id>            remove worktree, mark killed
  merge <id>           squash-merge a done story into the trunk branch
  log <id>             tail the latest phase log
  start [--fg]         start the daemon (background unless --fg)
  stop                 stop the daemon
  step <id>            single-step a story without the daemon (blocking)
  ui                   TUI dashboard (starts daemon if needed)

Configuration: .pitboss.json in the repo root
  { "piBin": "pi", "provider": "local", "model": "<id>", "workers": 2,
    "maxRetries": 3, "auto": "spec"|"review"|"full", "trunk": "main" }`;

const [cmd, ...rest] = process.argv.slice(2);

async function ctx() {
  const repo = findRepoRoot();
  const cfg = loadConfig(repo);
  return { repo, cfg, store: new Store(repo) };
}

async function withDaemonOrDirect(cfg, fn) {
  if (await isDaemonUp(cfg.daemonPort)) return fn.daemon();
  return fn.direct();
}

function printStories(stories) {
  if (!stories.length) return console.log("no stories yet — pitboss new \"<title>\"");
  const state = (s) => s.running ? `${s.state.toUpperCase()}*` : s.state.replace("_", " ").toUpperCase();
  const w = Math.max(...stories.map(s => (s.id + " " + s.title).length)) + 2;
  for (const s of stories) {
    const line = `${s.id} ${s.title}`;
    console.log(`${line.padEnd(w)} ${state(s).padEnd(14)} retries ${s.retries}${s.error ? "  ⚠ " + s.error : ""}`);
  }
}

function tail(fileAbs, n = 40) {
  if (!fs.existsSync(fileAbs)) return "";
  return fs.readFileSync(fileAbs, "utf8").split("\n").slice(-n).join("\n");
}

async function main() {
  if (!cmd || cmd === "help" || cmd === "--help") { console.log(HELP); return; }
  const { repo, cfg, store } = await ctx();

  const action = async (name, id, args = {}) =>
    withDaemonOrDirect(cfg, {
      daemon: () => callDaemon(name, id, args),
      direct: () => handleAction({ repo, cfg, store }, name, id, args),
    });

  switch (cmd) {
    case "new": {
      const title = rest.join(" ");
      if (!title) { console.error('usage: pitboss new "<title>"'); process.exit(1); }
      const s = await action("new", undefined, { title });
      console.log(`created ${s.id} · branch ${s.branch} · worktree ${s.worktree}`);
      if (!(await isDaemonUp(cfg.daemonPort))) console.log("(daemon not running — start it: pitboss start)");
      break;
    }
    case "list": {
      const up = await isDaemonUp(cfg.daemonPort);
      if (up) {
        const st = await (await fetch(`http://127.0.0.1:${cfg.daemonPort}/state`)).json();
        printStories(st.stories);
      } else printStories(store.stories());
      break;
    }
    case "show": {
      const s = store.get(rest[0] ?? "");
      if (!s) { console.error("story not found"); process.exit(1); }
      console.log(JSON.stringify(s, null, 2));
      if (s.lastReview) console.log(`\nlast review: ${s.lastReview.verdict} — ${s.lastReview.file}`);
      break;
    }
    case "approve": await action("approve", rest[0]); console.log(`approved ${rest[0]} — development will start`); break;
    case "retry": await action("retry", rest[0]); console.log(`reset ${rest[0]} for re-development`); break;
    case "kill": await action("kill", rest[0]); console.log(`killed ${rest[0]} (worktree removed)`); break;
    case "merge": {
      const s = await action("merge", rest[0]);
      console.log(s.state === "merged" ? `merged ${rest[0]} into ${cfg.trunk}` : `merge state: ${s.state} ${s.error ?? ""}`);
      break;
    }
    case "step": {
      const s = await action("step", rest[0]);
      console.log(`${s.id}: ${s.state}${s.error ? " — " + s.error : ""}`);
      break;
    }
    case "log": {
      const s = store.get(rest[0] ?? "");
      if (!s?.log.length) { console.error("no logs"); process.exit(1); }
      const last = s.log[s.log.length - 1];
      console.log(`── ${last.phase} · ${path.join(repo, last.file)} ──`);
      console.log(tail(path.join(repo, last.file), 60));
      break;
    }
    case "start": {
      if (await isDaemonUp(cfg.daemonPort)) { console.log("daemon already running"); break; }
      if (rest[0] === "--fg") {
        const d = await startDaemon(repo, cfg);
        console.log(`pitboss daemon on 127.0.0.1:${d.port} (ctrl-c to stop)`);
        process.on("SIGINT", async () => { await d.stop(); process.exit(0); });
        return new Promise(() => {});
      }
      const { spawn } = await import("node:child_process");
      const me = process.argv[1];
      const child = spawn(process.execPath, [me, "start", "--fg"], { detached: true, stdio: "ignore", cwd: repo, env: process.env });
      child.unref();
      await new Promise(r => setTimeout(r, 400));
      console.log(`daemon started (pid ${child.pid}, port ${cfg.daemonPort})`);
      break;
    }
    case "stop": {
      if (!(await isDaemonUp(cfg.daemonPort))) { console.log("daemon not running"); break; }
      // no dedicated endpoint in v0.1; kill by port via daemon's own /stop
      await fetch(`http://127.0.0.1:${cfg.daemonPort}/stop`, { method: "POST" }).catch(() => {});
      console.log("daemon stopped");
      break;
    }
    case "ui": {
      const { runUI } = await import("../src/ui.js");
      await runUI(repo, cfg.daemonPort);
      break;
    }
    default: console.error(`unknown command '${cmd}'\n`); console.log(HELP); process.exit(1);
  }
}

main().catch(e => { console.error(`error: ${e.message}`); process.exit(1); });

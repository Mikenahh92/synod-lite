#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, loadConfig } from "../src/core/config.ts";
import { Store } from "../src/core/store.ts";
import { isDaemonUp, callDaemon, startDaemon } from "../src/daemon.ts";
import { handleAction } from "../src/daemon.ts";

const HELP = `synod-lite — story harness for pi + dev-agents

Usage: synod-lite <command> [args]
  init                 scaffold dev-agents workflows + config into the CURRENT repo
                       (agents, 6 workflows, AGENTS.md, .pi/.codex prompts, .synod-lite.json)
  new "<title>"        create a story (worktree + branch), spec starts automatically (daemon)
  list                 overview of all stories
  show <id>            story details (state, retries, last review, logs)
  approve <id>         approve the spec — development starts automatically (daemon)
  retry <id>           reset a failed/blocked story to re-develop (retries reset)
  reset <id> --to <phase> [--code]   reset to spec|develop|review|mergeable; --code also
                       hard-resets the story branch to trunk (discards commits)
  kill <id>            remove worktree, mark cancelled
  merge <id>           squash-merge a done story into the trunk branch
  log <id>             tail the latest phase log
  start [--fg]         start the daemon (background unless --fg)
  stop                 stop the daemon
  step <id>            single-step a story without the daemon (blocking)
  ui                   TUI dashboard (starts daemon if needed)

Configuration: .synod-lite.json in the repo root
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

const CLI_LABEL = {
  drafted: "DRAFTED", refining: "REFINING", ready_for_user_review: "AWAIT OK", in_development: "DEVELOPING",
  in_review: "IN REVIEW", merging: "MERGING", ready_for_merge: "MERGEABLE", done: "DONE",
  blocked: "BLOCKED", failed: "FAILED", cancelled: "CANCELLED",
};
function printStories(stories) {
  if (!stories.length) return console.log("no stories yet — synod-lite new \"<title>\"");
  const cols = process.stdout.columns || 100;
  const stateW = 10, retryW = 9;
  const titleW = Math.max(10, cols - 6 - 2 - stateW - 1 - retryW);
  for (const s of stories) {
    const label = (CLI_LABEL[s.state] ?? s.state) + (s.running ? "*" : "");
    const title = s.title.length > titleW ? s.title.slice(0, titleW - 1) + "…" : s.title.padEnd(titleW);
    const err = s.error ? `  ⚠ ${s.error}` : "";
    const base = `${s.id} ${title} ${label.padEnd(stateW)} r${s.retries}${s.lastReview ? (s.lastReview.verdict === "PASS" ? " ✓" : " ✗") : ""}`;
    console.log(err && base.length + err.length > cols ? base + err.slice(0, cols - base.length - 1) + "…" : base + err);
  }
}

function tail(fileAbs, n = 40) {
  if (!fs.existsSync(fileAbs)) return "";
  return fs.readFileSync(fileAbs, "utf8").split("\n").slice(-n).join("\n");
}

import { fileURLToPath } from "node:url";

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "template");

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

function cmdInit(target = process.cwd()) {
  const t = (n) => path.join(TEMPLATE_DIR, n);
  fs.mkdirSync(path.join(target, ".dev-agents"), { recursive: true });
  // never clobber user config
  const cfgPath = path.join(target, ".dev-agents", "config.yaml");
  if (fs.existsSync(cfgPath)) console.log("keeping existing .dev-agents/config.yaml");
  else fs.copyFileSync(t(".dev-agents/config.yaml"), cfgPath);
  for (const d of ["agents", "core", "workflows"]) copyTree(t(`.dev-agents/${d}`), path.join(target, ".dev-agents", d));
  fs.rmSync(path.join(target, ".dev-agents/core/tasks/workflow-yolo.xml"), { force: true }); // stale engine
  copyTree(t(".pi"), path.join(target, ".pi"));
  copyTree(t(".codex"), path.join(target, ".codex"));
  fs.copyFileSync(t("AGENTS.md"), path.join(target, "AGENTS.md"));
  // gitignore agent output
  const gi = path.join(target, ".gitignore");
  const giTxt = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!/^\.dev-agents\/output\/$/m.test(giTxt))
    fs.writeFileSync(gi, giTxt + (giTxt.endsWith("\n") || !giTxt ? "" : "\n") + ".dev-agents/output/\n");
  // harness config
  const sl = path.join(target, ".synod-lite.json");
  if (!fs.existsSync(sl)) {
    fs.copyFileSync(path.join(TEMPLATE_DIR, "..", ".synod-lite.example.json"), sl);
    console.log("created .synod-lite.json (edit: piBin, provider, model)");
  } else console.log("keeping existing .synod-lite.json");
  console.log(`scaffolded dev-agents into ${target}`);
  console.log("next: edit .dev-agents/config.yaml (user_name, language) → synod-lite start");
}

async function main() {
  if (!cmd || cmd === "help" || cmd === "--help") { console.log(HELP); return; }
  if (cmd === "init") { cmdInit(rest[0]); return; }
  const { repo, cfg, store } = await ctx();

  const action = async (name, id, args = {}) =>
    withDaemonOrDirect(cfg, {
      daemon: () => callDaemon(cfg.daemonPort, name, id, args),
      direct: () => handleAction({ repo, cfg, store }, name, id, args),
    });

  switch (cmd) {
    case "new": {
      const title = rest.join(" ");
      if (!title) { console.error('usage: synod-lite new "<title>"'); process.exit(1); }
      const s = await action("new", undefined, { title });
      console.log(`drafted ${s.id} · branch ${s.branch} · worktree ${s.worktree}`);
      if (!(await isDaemonUp(cfg.daemonPort))) console.log("(daemon not running — start it: synod-lite start)");
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
      const cols = process.stdout.columns || 100;
      const fit = (t, w) => t.length > w ? t.slice(0, w - 1) + "…" : t;
      const kv = (k, v) => fit(`${k.padEnd(13)}${v}`, cols);
      console.log(`${s.id} · ${s.title}`);
      console.log(kv("state", `${s.state}${s.running ? " (running)" : ""}`));
      console.log(kv("retries", String(s.retries)));
      console.log(kv("branch", s.branch));
      console.log(kv("worktree", s.worktree));
      console.log(kv("created", String(s.createdAt).slice(0, 16).replace("T", " ")));
      console.log(kv("updated", String(s.updatedAt).slice(0, 16).replace("T", " ")));
      if (s.lastReview) console.log(kv("last review", `${s.lastReview.verdict} — ${s.lastReview.file}`));
      if (s.error) console.log(kv("error", `⚠ ${s.error}`));
      console.log(kv("phases", s.log.map(l => l.phase).join(" → ") || "none yet"));
      break;
    }
    case "approve": await action("approve", rest[0]); console.log(`approved ${rest[0]} — development will start`); break;
    case "retry": await action("retry", rest[0]); console.log(`reset ${rest[0]} for re-development`); break;
    case "reset": {
      const to = rest.includes("--to") ? rest[rest.indexOf("--to") + 1] : "";
      const code = rest.includes("--code");
      const s = await action("reset", rest[0], { to, code });
      console.log(`reset ${s.id} → ${s.state}${code ? " (branch reset to " + cfg.trunk + ")" : ""}`);
      break;
    }
    case "kill": await action("kill", rest[0]); console.log(`cancelled ${rest[0]} (worktree removed)`); break;
    case "merge": {
      const s = await action("merge", rest[0]);
      console.log(s.state === "done" ? `merged ${rest[0]} into ${cfg.trunk}` : `merge state: ${s.state} ${s.error ?? ""}`);
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
        console.log(`synod-lite daemon on 127.0.0.1:${d.port} (ctrl-c to stop)`);
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

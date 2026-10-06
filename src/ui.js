// pitboss TUI — ink dashboard (no JSX build step: plain createElement)
import React, { useEffect, useState, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { spawn } from "node:child_process";
import { callDaemon, isDaemonUp } from "./daemon.ts";

const h = React.createElement;
const STATE_COLORS = {
  speccing: "yellow", developing: "cyan", reviewing: "magenta",
  merging: "blue", done: "green", merged: "green",
  spec_ready: "yellowBright", needs_human: "red", failed: "red", killed: "gray",
};

function fetchState(port) {
  return fetch(`http://127.0.0.1:${port}/state`).then(r => r.json());
}

function App({ port }) {
  const { exit } = useApp();
  const [state, setState] = useState(null);
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState("");
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => fetchState(port).then(setState).catch(() => {}), 1000);
    fetchState(port).then(setState).catch(() => {});
    return () => clearInterval(iv);
  }, [port]);

  const stories = state?.stories ?? [];
  const cur = stories[Math.min(sel, stories.length - 1)];

  const act = useCallback(async (action, args = {}) => {
    if (!cur && action !== "new") return;
    try {
      await callDaemon(port, action, action === "new" ? undefined : cur.id, args);
      setMsg(`${action} ${action === "new" ? "" : cur.id} ✓`);
      setTimeout(() => setMsg(""), 2500);
    } catch (e) { setMsg(`✗ ${e.message}`); setTimeout(() => setMsg(""), 4000); }
  }, [cur, port]);

  useInput((input, key) => {
    if (key.return && showLog) { setShowLog(false); return; }
    if (showLog) return;
    switch (input) {
      case "q": exit(); break;
      case "j": case key.downArrow: setSel(s => Math.min(s + 1, stories.length - 1)); break;
      case "k": case key.upArrow: setSel(s => Math.max(s - 1, 0)); break;
      case "n": {
        // new story: quick prompt via external editor is out of scope v0.1 — read title from stdin fallback
        setMsg("new story: use CLI — pitboss new \"<title>\"");
        setTimeout(() => setMsg(""), 3500);
        break;
      }
      case "a": act("approve"); break;
      case "r": act("retry"); break;
      case "m": act("merge"); break;
      case "K": act("kill"); break;
      case "l": setShowLog(true); break;
    }
  });

  if (!state) return h(Text, { color: "gray" }, `connecting to pitboss daemon on 127.0.0.1:${port}… (run: pitboss start)`);

  const line = (s, i) =>
    h(Box, { key: s.id },
      h(Text, { color: i === sel ? "black" : (STATE_COLORS[s.state] ?? "white"), backgroundColor: i === sel ? "cyan" : undefined },
        ` ${s.running ? "●" : s.state === "merged" ? "✓" : s.state === "spec_ready" ? "◆" : "○"} `),
      h(Text, { color: i === sel ? "cyan" : "white", bold: i === sel },
        `${s.id} ${s.title.slice(0, 30).padEnd(30)} `),
      h(Text, { color: STATE_COLORS[s.state] ?? "white" },
        (s.running ? s.state.toUpperCase() + "*" : s.state.replace("_", " ").toUpperCase()).padEnd(14)),
      h(Text, { color: "gray" }, ` r${s.retries}${s.lastReview ? " " + s.lastReview.verdict : ""}`));

  const detail = cur
    ? [
        h(Text, { bold: true }, `${cur.id} · ${cur.title}`),
        h(Text, { color: STATE_COLORS[cur.state] ?? "white" }, `state: ${cur.state}${cur.running ? " (running)" : ""} · retries ${cur.retries}`),
        h(Text, { color: "gray" }, `branch ${cur.branch} · worktree ${cur.worktree}`),
        cur.lastReview ? h(Text, { color: cur.lastReview.verdict === "PASS" ? "green" : "red" }, `last review: ${cur.lastReview.verdict} — ${cur.lastReview.file}`) : null,
        cur.error ? h(Text, { color: "red" }, `⚠ ${cur.error}`) : null,
        h(Text, { color: "gray" }, ""),
        showLog
          ? h(Box, { flexDirection: "column" },
              h(Text, { bold: true }, `── log (last phase: ${cur.log[cur.log.length - 1]?.phase ?? "none"}) ──`),
              h(Text, null, (state.tails[cur.id] || "(no log output)").split("\n").slice(-18).join("\n").slice(-2000)))
          : h(Text, { color: "gray" }, `phases: ${cur.log.map(l => l.phase).join(" → ") || "none yet"}`),
      ].filter(Boolean)
    : [h(Text, { color: "gray" }, "no stories — pitboss new \"<title>\"")];

  return h(Box, { flexDirection: "column", height: "100%" },
    h(Box, { flexDirection: "row" },
      h(Box, { borderStyle: "round", flexDirection: "column", width: "50%" },
        h(Text, { bold: true }, ` Stories (${stories.length})`),
        ...stories.map(line),
        h(Text, { color: "gray" }, ""),
        h(Text, { color: "gray" }, ` ${state.runningIds.length} running · workers ${state.config.workers} · auto ${state.config.auto} · trunk ${state.config.trunk}`)),
      h(Box, { borderStyle: "round", flexDirection: "column", width: "50%" },
        h(Text, { bold: true }, " Detail"),
        ...detail)),
    h(Box, null,
      h(Text, { color: msg.startsWith("✗") ? "red" : "green" }, ` ${msg}`)),
    h(Box, null,
      h(Text, { dim: true }, " [a]pprove  [r]etry  [m]erge  [K]ill  [l]og  [j/k] move  [q]uit"))
  );
}

export async function runUI(repo, port) {
  if (!(await isDaemonUp(port))) {
    // auto-start daemon in background
    const me = new URL(import.meta.url).pathname;
    const bin = me.replace(/src\/ui\.js$/, "bin/pitboss.js");
    const child = spawn(process.execPath, [bin, "start", "--fg"], { detached: true, stdio: "ignore", cwd: repo });
    child.unref();
    await new Promise(r => setTimeout(r, 600));
    if (!(await isDaemonUp(port))) {
      console.error("could not start pitboss daemon");
      process.exit(1);
    }
  }
  render(h(App, { port }), { exitOnCtrlC: true });
}

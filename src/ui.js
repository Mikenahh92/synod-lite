// synod-lite TUI — ink dashboard (no JSX build step: plain createElement)
import React, { useEffect, useState, useCallback } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { spawn } from "node:child_process";
import { callDaemon, isDaemonUp } from "./daemon.ts";

const h = React.createElement;
const STATE_COLORS = {
  refining: "yellow", in_development: "cyan", in_review: "magenta",
  merging: "blue", ready_for_merge: "green", done: "green",
  ready_for_user_review: "yellowBright", blocked: "red", failed: "red", cancelled: "gray",
};
// compact, fixed-width display labels (max 10 chars) — layout stays deterministic
const LABEL = {
  drafted: "DRAFTED", refining: "REFINING", ready_for_user_review: "AWAITING",
  in_development: "DEVELOPING", in_review: "IN REVIEW", merging: "MERGING",
  ready_for_merge: "MERGEABLE", done: "DONE", blocked: "BLOCKED",
  failed: "FAILED", cancelled: "CANCELLED",
};
const trunc = (t, n) => (t.length > n ? t.slice(0, Math.max(0, n - 1)) + "…" : t).padEnd(n);
const fit = (t, n) => (t.length > n ? t.slice(0, Math.max(0, n - 1)) + "…" : t);

function fetchState(port) {
  return fetch(`http://127.0.0.1:${port}/state`).then(r => r.json());
}

function App({ port }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, setState] = useState(null);
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [composer, setComposer] = useState(null); // { buf } while typing a new story title

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

  useInput((ch, key) => {
    // ── new-story composer (input mode) ───────────────────
    if (composer) {
      if (key.escape) { setComposer(null); return; }
      if (key.return) {
        const title = composer.buf.trim();
        setComposer(null);
        if (title) act("new", { title }); else setMsg("(empty title — cancelled)");
        return;
      }
      if (key.backspace || key.delete) { setComposer({ buf: composer.buf.slice(0, -1) }); return; }
      if (ch && ch.length === 1 && !key.ctrl && !key.meta) { setComposer({ buf: (composer.buf + ch).slice(0, 80) }); return; }
      return;
    }
    if (key.return && showLog) { setShowLog(false); return; }
    if (showLog) return;
    switch (ch) {
      case "q": exit(); break;
      case "j": case key.downArrow: setSel(s => Math.min(s + 1, stories.length - 1)); break;
      case "k": case key.upArrow: setSel(s => Math.max(s - 1, 0)); break;
      case "n": setComposer({ buf: "" }); break;
      case "a": act("approve"); break;
      case "r": act("retry"); break;
      case "m": act("merge"); break;
      case "K": act("kill"); break;
      case "l": setShowLog(true); break;
    }
  });

  if (!state) return h(Text, { color: "gray" }, `connecting to synod-lite daemon on 127.0.0.1:${port}… (run: synod-lite start)`);

  // deterministic column math — rows can never overflow their pane
  const cols = stdout?.columns || 110;
  const paneInner = Math.floor(cols / 2) - 2; // border chars
  const titleW = paneInner - 24;              // icon+id+state+retries gutter
  const rowBg = (i) => (i === sel ? "cyan" : undefined);

  const line = (s, i) =>
    h(Box, { key: s.id },
      h(Text, { wrap: false, color: i === sel ? "black" : (STATE_COLORS[s.state] ?? "white"), backgroundColor: rowBg(i) },
        ` ${s.running ? "●" : s.state === "done" ? "✓" : s.state === "ready_for_user_review" ? "◆" : "○"} ${s.id} ${trunc(s.title, titleW)}`),
      h(Text, { wrap: false, color: i === sel ? "black" : (STATE_COLORS[s.state] ?? "white"), backgroundColor: rowBg(i) },
        `${((LABEL[s.state] ?? s.state) + (s.running ? "*" : "")).padStart(10)}`),
      h(Text, { wrap: false, color: i === sel ? "black" : "gray", backgroundColor: rowBg(i) },
        ` r${s.retries}${s.lastReview ? (s.lastReview.verdict === "PASS" ? "✓" : "✗") : " "}`));

  const T = (props, t) => h(Text, { ...props, wrap: false }, fit(t, paneInner));
  const detail = cur
    ? [
        T({ bold: true }, `${cur.id} · ${cur.title}`),
        T({ color: STATE_COLORS[cur.state] ?? "white" }, `state: ${cur.state}${cur.running ? " (running)" : ""} · retries ${cur.retries}`),
        T({ color: "gray" }, `branch ${cur.branch} · worktree ${cur.worktree}`),
        cur.lastReview ? T({ color: cur.lastReview.verdict === "PASS" ? "green" : "red" }, `last review: ${cur.lastReview.verdict} — ${cur.lastReview.file}`) : null,
        cur.error ? T({ color: "red" }, `⚠ ${cur.error}`) : null,
        h(Text, { color: "gray", wrap: false }, ""),
        showLog
          ? h(Box, { flexDirection: "column" },
              h(Text, { bold: true, wrap: false }, fit(`── log (last phase: ${cur.log[cur.log.length - 1]?.phase ?? "none"}) ──`, paneInner)),
              h(Text, { wrap: false }, (state.tails[cur.id] || "(no log output)").split("\n").slice(-18).map(l => fit(l, paneInner)).join("\n")))
          : T({ color: "gray" }, `phases: ${cur.log.map(l => l.phase).join(" → ") || "none yet"}`),
      ].filter(Boolean)
    : [h(Text, { color: "gray" }, "no stories — synod-lite new \"<title>\"")];

  return h(Box, { flexDirection: "column", height: "100%" },
    h(Box, { flexDirection: "row" },
      h(Box, { borderStyle: "single", flexDirection: "column", width: "50%" },
        h(Text, { bold: true }, ` Stories (${stories.length})`),
        ...stories.map(line),
        h(Text, { color: "gray" }, ""),
        h(Text, { color: "gray" }, ` ${state.runningIds.length} running · workers ${state.config.workers} · auto ${state.config.auto} · trunk ${state.config.trunk}`)),
      h(Box, { borderStyle: "single", flexDirection: "column", width: "50%" },
        h(Text, { bold: true }, " Detail"),
        ...detail)),
    h(Box, null,
      h(Text, { color: msg.startsWith("✗") ? "red" : "green" }, ` ${msg}`)),
    h(Box, null,
      composer
        ? h(Text, { color: "cyan", wrap: false }, ` new story ▸ ${composer.buf}▌  `)
        : h(Text, { dim: true }, " [n]ew  [a]pprove  [r]etry  [m]erge  [K]ill  [l]og  [j/k] move  [q]uit")),
    composer
      ? h(Box, null, h(Text, { dim: true, wrap: false }, " Enter create · Esc cancel"))
      : null,
  );
}

export async function runUI(repo, port) {
  if (!(await isDaemonUp(port))) {
    // auto-start daemon in background
    const me = new URL(import.meta.url).pathname;
    const bin = me.replace(/src\/ui\.js$/, "bin/synod-lite.js");
    const child = spawn(process.execPath, [bin, "start", "--fg"], { detached: true, stdio: "ignore", cwd: repo });
    child.unref();
    await new Promise(r => setTimeout(r, 600));
    if (!(await isDaemonUp(port))) {
      console.error("could not start synod-lite daemon");
      process.exit(1);
    }
  }
  render(h(App, { port }), { exitOnCtrlC: true });
}

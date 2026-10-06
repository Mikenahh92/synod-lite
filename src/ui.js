// synod-lite TUI — ink dashboard (no JSX build step: plain createElement)
import React, { useEffect, useState, useCallback } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { spawn } from "node:child_process";
import { callDaemon, isDaemonUp } from "./daemon.ts";

const h = React.createElement;
// Synod brand palette (synod-shared/branding/brand-guide.md)
const C = {
  bg: "#0F1117", panel: "#151A23", border: "#242B3A",
  text: "#E6EAF2", dim: "#A3AAB8", accent: "#36D6D6",
  green: "#7EC699", yellow: "#E5C07B", red: "#E06C75", magenta: "#C678DD", blue: "#7AA2F7",
};
const STATE_COLORS = {
  refining: C.yellow, in_development: C.accent, in_review: C.magenta,
  merging: C.blue, ready_for_merge: C.green, done: C.green,
  ready_for_user_review: C.yellow, blocked: C.red, failed: C.red, cancelled: C.dim,
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
  const [composer, setComposer] = useState(null); // { buf } while typing (new story or chat)
  const [chat, setChat] = useState(null);          // { msgs: [{role, text}] } when chat column open

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

  const sendChat = useCallback(async (text) => {
    setChat(c => ({ ...(c ?? { msgs: [] }), msgs: [...(c?.msgs ?? []), { role: "you", text }], busy: true }));
    try {
      const r = await callDaemon(port, "chat", undefined, { message: text });
      setChat(c => ({ msgs: [...c.msgs, { role: "agent", text: r.reply },
        ...(r.action ? [{ role: "action", text: `${r.action} → ${r.actionResult}` }] : [])], busy: false }));
    } catch (e) {
      setChat(c => ({ msgs: [...c.msgs, { role: "agent", text: `✗ ${e.message}` }], busy: false }));
    }
  }, [port]);

  useInput((ch, key) => {
    // ── composer (new story / chat message) ────────────────
    if (composer) {
      if (key.escape) { setComposer(null); return; }
      if (key.return) {
        const text = composer.buf.trim();
        setComposer(null);
        if (!text) { setMsg("(empty — cancelled)"); return; }
        if (chat) sendChat(text); else act("new", { title: text });
        return;
      }
      if (key.backspace || key.delete) { setComposer({ buf: composer.buf.slice(0, -1) }); return; }
      if (ch && ch.length === 1 && !key.ctrl && !key.meta) { setComposer({ buf: (composer.buf + ch).slice(0, 80) }); return; }
      return;
    }
    if (key.escape && chat) { setChat(null); return; }
    if (key.return && showLog) { setShowLog(false); return; }
    if (showLog) return;
    switch (ch) {
      case "q": exit(); break;
      case "j": case key.downArrow: setSel(s => Math.min(s + 1, stories.length - 1)); break;
      case "k": case key.upArrow: setSel(s => Math.max(s - 1, 0)); break;
      case "n": setComposer({ buf: "" }); break;
      case "c": setChat(chat ? null : { msgs: [] }); break;
      case "a": act("approve"); break;
      case "r": act("retry"); break;
      case "m": act("merge"); break;
      case "K": act("kill"); break;
      case "l": setShowLog(true); break;
    }
  });

  if (!state) return h(Text, { color: C.dim }, `connecting to synod-lite daemon on 127.0.0.1:${port}… (run: synod-lite start)`);

  // deterministic column math — rows can never overflow their pane
  const cols = stdout?.columns || 110;
  const listW = Math.floor((cols - 2) * 0.6);  // story list gets the wide share
  const rightW = cols - 2 - listW;            // detail/chat pane
  const paneInner = listW - 2;                // border chars (row math)
  const rightInner = rightW - 2;              // detail/chat content width
  const titleW = paneInner - 25;              // icon+id+state+retries columns
  const rowBg = (i) => (i === sel ? C.accent : undefined);

  const line = (s, i) => {
    const icon = s.running ? "●" : s.state === "done" ? "✓" : s.state === "ready_for_user_review" ? "◆" : "○";
    const label = ((LABEL[s.state] ?? s.state) + (s.running ? "*" : "")).padStart(10);
    const spacer = Math.max(2, titleW + 1 - s.title.slice(0, titleW).length); // clear column boundary (≥2 gap)
    const row = ` ${icon} ${s.id} ${s.title.slice(0, titleW)}${" ".repeat(spacer)}${label} r${s.retries}${s.lastReview ? (s.lastReview.verdict === "PASS" ? "✓" : "✗") : " "}`;
    return h(Text, { key: s.id, wrap: false, bold: i === sel,
      color: i === sel ? "#0F1117" : (STATE_COLORS[s.state] ?? C.text), backgroundColor: rowBg(i) },
      row.length > paneInner ? row.slice(0, paneInner - 1) + "…" : row);
  };

  const contentW = rightInner - 2; // 1 char left pad + 1 right margin
  const T = (props, t) => h(Text, { ...props, wrap: false }, ` ${fit(t, contentW)}`);
  const detail = cur
    ? [
        T({ bold: true, color: C.text }, `${cur.id} · ${cur.title}`),
        T({ color: STATE_COLORS[cur.state] ?? "white" }, `state: ${cur.state}${cur.running ? " (running)" : ""} · retries ${cur.retries}`),
        T({ color: C.dim }, `branch ${cur.branch} · worktree ${cur.worktree}`),
        cur.lastReview ? T({ color: cur.lastReview.verdict === "PASS" ? "green" : "red" }, `last review: ${cur.lastReview.verdict} — ${cur.lastReview.file}`) : null,
        cur.error ? T({ color: "red" }, `⚠ ${cur.error}`) : null,
        h(Text, { color: "gray", wrap: false }, ""),
        showLog
          ? h(Box, { flexDirection: "column" },
              h(Text, { bold: true, wrap: false }, fit(`── log (last phase: ${cur.log[cur.log.length - 1]?.phase ?? "none"}) ──`, contentW)),
              h(Text, { wrap: false }, (state.tails[cur.id] || "(no log output)").split("\n").slice(-Math.max(3, logH)).map(l => fit(l, contentW)).join("\n")))
          : T({ color: C.dim }, `phases: ${cur.log.map(l => l.phase).join(" → ") || "none yet"}`),
      ].filter(Boolean)
    : [h(Text, { color: "gray" }, "no stories — synod-lite new \"<title>\"")];

  // ── full-terminal layout ────────────────────────────────
  const rows = stdout?.rows || 30;
  const footerH = 3;                                  // title bar + status + controls
  const paneH = Math.max(6, rows - footerH);          // pane row incl. borders
  const listH = paneH - 4;                            // minus borders/header/summary
  const start = stories.length <= listH ? 0
    : Math.max(0, Math.min(sel - (listH >> 1), stories.length - listH));
  const visible = stories.slice(start, start + listH);
  const logH = paneH - 9;                             // detail chrome + log header

  return h(Box, { flexDirection: "column", height: rows, backgroundColor: C.bg },
    h(Box, { height: 1, backgroundColor: C.panel },
      (() => {
        const right = `${state.runningIds.length}/${stories.length} stories · port ${port} `;
        const pad = Math.max(1, cols - 13 - right.length - 2);
        return [
          h(Text, { bold: true, color: C.accent, wrap: false }, ` ◆ synod-lite${" ".repeat(pad)}`),
          h(Text, { color: C.dim, wrap: false }, right),
        ];
      })()),
    h(Box, { flexDirection: "row", height: paneH },
      h(Box, { borderStyle: "single", borderColor: C.border, backgroundColor: C.panel, flexDirection: "column", width: listW },
        h(Box, { flexDirection: "row" },
          h(Text, { bold: true, color: C.text, wrap: false }, " Stories ("),
          h(Text, { bold: true, color: C.accent, wrap: false }, String(stories.length)),
          h(Text, { bold: true, color: C.text, wrap: false }, ")")),
        start > 0 ? h(Text, { color: C.dim, wrap: false }, ` ↑ ${start} more`) : null,
        ...visible.map(line),
        (start + listH < stories.length) ? h(Text, { color: C.dim, wrap: false }, ` ↓ ${stories.length - start - listH} more`) : null,
        h(Box, { flexGrow: 1 }),
        h(Text, { color: C.dim }, ` ${state.runningIds.length} running · workers ${state.config.workers} · auto ${state.config.auto} · trunk ${state.config.trunk}`)),
      h(Box, { width: 2 }),
      h(Box, { borderStyle: "single", borderColor: chat ? C.accent : C.border, backgroundColor: C.panel, flexDirection: "column", width: rightW },
        chat
          ? [h(Text, { bold: true, color: C.accent }, ` Chat${chat.busy ? ` ${fit("· thinking…", contentW - 5)}` : ""}`),
             ...chat.msgs.slice(-(paneH - 4)).map((m, i) =>
               h(Text, { wrap: false, color: m.role === "you" ? C.accent : m.role === "action" ? C.green : C.text },
                 ` ${fit(`${m.role === "you" ? "you ▸ " : m.role === "action" ? "⚡ " : "◂ "}${m.text}`, contentW)}`)),
             h(Box, { flexGrow: 1 })]
          : [h(Text, { bold: true, color: C.text }, " Detail"), ...detail])),
    h(Box, { height: 1 },
      composer
        ? h(Text, { color: C.accent, wrap: false }, ` ${chat ? "chat" : "new story"} ▸ ${composer.buf}▌   ⏎ send · esc cancel`)
        : h(Text, { color: msg.startsWith("✗") ? C.red : C.green, wrap: false }, ` ${msg}`)),
    h(Box, { height: 1 },
      chat
        ? [h(Text, { color: C.accent, wrap: false }, " n"), h(Text, { color: C.dim, wrap: false }, " message  "),
           h(Text, { color: C.accent, wrap: false }, "esc"), h(Text, { color: C.dim, wrap: false }, " close chat  "),
           h(Text, { color: C.accent, wrap: false }, "j/k"), h(Text, { color: C.dim, wrap: false }, " move  "),
           h(Text, { color: C.accent, wrap: false }, "q"), h(Text, { color: C.dim, wrap: false }, " uit")]
        : [["n","ew"],["a","pprove"],["r","etry"],["m","erge"],["K","ill"],["l","og"],["c","hat"],["j/k"," move"],["q","uit"]]
          .flatMap(([k, rest], i) => [
            ...(i ? [h(Text, { color: C.border, wrap: false }, " · ")] : []),
            h(Text, { color: C.accent, wrap: false }, ` ${k}`),
            h(Text, { color: C.dim, wrap: false }, rest),
          ]))
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

// synod-lite TUI — ink dashboard (no JSX build step: plain createElement)
// Two full-page modes: list (filter/navigate) ↔ detail (paged documents, fixed header).
// Chat is a toggleable right column in both modes; typing goes straight to chat when open.
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
const STATUS_FILTERS = ["all", "active", "done", "blocked"];
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
  const [mode, setMode] = useState("list");           // list | detail
  const [composer, setComposer] = useState(null);     // { kind: "new"|"filter"|"chat", buf }
  const [chat, setChat] = useState(null);             // { msgs: [{role, text}], busy }
  const [filter, setFilter] = useState({ text: "", status: "all" });
  const [detailView, setDetailView] = useState(null); // { id, docs: [{name, lines}], di, scroll, locked, state }

  useEffect(() => {
    const iv = setInterval(() => fetchState(port).then(setState).catch(() => {}), 1000);
    fetchState(port).then(setState).catch(() => {});
    return () => clearInterval(iv);
  }, [port]);

  const storiesAll = state?.stories ?? [];
  const filtered = storiesAll.filter(s =>
    (filter.status === "all" ? true
      : filter.status === "active" ? !["done", "cancelled"].includes(s.state)
      : s.state === filter.status))
    .filter(s => !filter.text || `${s.id} ${s.title}`.toLowerCase().includes(filter.text.toLowerCase()));
  const cur = filtered[Math.min(sel, filtered.length - 1)] ?? storiesAll[0];

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
      const r = await callDaemon(port, "chat", undefined, {
        message: text,
        focus: cur?.id,
        doc: mode === "detail" && detailView?.id === cur?.id ? detailView.docs[detailView.di]?.name : undefined,
      });
      setChat(c => ({ msgs: [...c.msgs, { role: "agent", text: r.reply },
        ...(r.action ? [{ role: "action", text: `${r.action} → ${r.actionResult}` }] : [])], busy: false }));
    } catch (e) {
      setChat(c => ({ msgs: [...c.msgs, { role: "agent", text: `✗ ${e.message}` }], busy: false }));
    }
  }, [port, cur, mode, detailView]);

  const openDetail = useCallback(async (story) => {
    if (!story) return;
    try {
      const r = await callDaemon(port, "spec", story.id);
      setDetailView({
        id: story.id,
        docs: [
          { name: "Details", lines: null }, // built live at render
          { name: "Spec", lines: (r.spec ?? "(no spec authored yet)").split("\n") },
          { name: "Test design", lines: (r.testDesign ?? "(none)").split("\n") },
          { name: "Review", lines: (r.review ?? "(no review yet)").split("\n") },
          { name: "Log", lines: null }, // live tail
        ],
        di: 1, scroll: 0, locked: r.locked, state: r.state,
      });
      setMode("detail");
    } catch (e) { setMsg(`✗ ${e.message}`); setTimeout(() => setMsg(""), 4000); }
  }, [port]);

  useInput((ch, key) => {
    // ── chat open: every printable key goes to the chat buffer ──
    if (chat && !composer) {
      if (key.escape) { setChat(null); return; }
      if (key.return) { const t = (chat.draft ?? "").trim(); if (t) { setChat({ ...chat, draft: "" }); sendChat(t); } return; }
      if (key.backspace || key.delete) { setChat({ ...chat, draft: (chat.draft ?? "").slice(0, -1) }); return; }
      if (ch && ch.length === 1 && !key.ctrl && !key.meta) { setChat({ ...chat, draft: (chat.draft ?? "") + ch }); return; }
      return;
    }
    // ── composer (new story / list filter) ────────────────────
    if (composer) {
      if (key.escape) { setComposer(null); if (composer.kind === "filter") setFilter(f => ({ ...f, text: "" })); return; }
      if (key.return) {
        const text = composer.buf.trim();
        setComposer(null);
        if (!text) { if (composer.kind === "filter") setFilter(f => ({ ...f, text: "" })); return; }
        if (composer.kind === "new") act("new", { title: text });
        else setFilter(f => ({ ...f, text }));
        return;
      }
      if (key.backspace || key.delete) { setComposer({ ...composer, buf: composer.buf.slice(0, -1) }); return; }
      if (ch && ch.length === 1 && !key.ctrl && !key.meta) { setComposer({ ...composer, buf: (composer.buf + ch).slice(0, 80) }); return; }
      return;
    }
    if (key.escape) {
      if (mode === "detail") { setMode("list"); return; }
      if (filter.text || filter.status !== "all") { setFilter({ text: "", status: "all" }); return; }
      return;
    }
    // ── arrows + enter: handled explicitly (switch(ch) can't match them) ──
    if (key.upArrow) {
      if (mode === "list") setSel(s => Math.max(0, s - 1));
      else setDetailView(v => v && ({ ...v, scroll: Math.max(0, v.scroll - 1) }));
      return;
    }
    if (key.downArrow) {
      if (mode === "list") setSel(s => Math.min(s + 1, filtered.length - 1));
      else setDetailView(v => v && ({ ...v, scroll: Math.min(v.scroll + 1, Math.max(0, detailLines(v).length)) }));
      return;
    }
    if (key.leftArrow) {
      if (mode === "detail") setDetailView(v => v && ({ ...v, di: (v.di + v.docs.length - 1) % v.docs.length, scroll: 0 }));
      return;
    }
    if (key.rightArrow) {
      if (mode === "detail") setDetailView(v => v && ({ ...v, di: (v.di + 1) % v.docs.length, scroll: 0 }));
      return;
    }
    if (key.return) {
      if (mode === "list") openDetail(cur);
      return;
    }
    if (!ch || ch.length !== 1 || key.ctrl || key.meta) return;
    switch (ch) {
      case "q": exit(); break;
      case "j":
        if (mode === "list") setSel(s => Math.min(s + 1, filtered.length - 1));
        else setDetailView(v => v && ({ ...v, scroll: Math.min(v.scroll + 1, Math.max(0, detailLines(v).length)) }));
        break;
      case "k":
        if (mode === "list") setSel(s => Math.max(0, s - 1));
        else setDetailView(v => v && ({ ...v, scroll: Math.max(0, v.scroll - 1) }));
        break;
      case "n": setComposer({ kind: "new", buf: "" }); break;
      case "f": if (mode === "list") setComposer({ kind: "filter", buf: filter.text }); break;
      case "s":
        if (mode === "list") setFilter(f => ({ ...f, status: STATUS_FILTERS[(STATUS_FILTERS.indexOf(f.status) + 1) % STATUS_FILTERS.length] }));
        break;
      case "c": setChat({ msgs: [], draft: "" }); break; // opens chat; typing goes straight in
      case "a": act("approve"); break;
      case "r": act("retry"); break;
      case "m": act("merge"); break;
      case "K": act("kill"); break;
    }
  });

  if (!state) return h(Text, { color: C.dim }, `connecting to synod-lite daemon on 127.0.0.1:${port}… (run: synod-lite start)`);

  // deterministic column math — rows can never overflow their pane
  const cols = stdout?.columns || 110;
  const chatW = chat ? Math.max(30, Math.floor(cols * 0.36)) : 0;
  const mainW = cols - (chat ? 2 + chatW : 0);       // gutter (2) when chat open
  const mainInner = mainW - 2;
  const chatInner = chat ? chatW - 2 : 0;
  const chatW2 = chat ? chatInner - 2 : 0;
  const titleW = mainInner - 25;
  const rowBg = (i) => (i === sel ? C.accent : undefined);

  const wrapTitle = (title, w1, w2) => {
    const words = title.split(/\s+/);
    const l1 = [], l2 = [];
    let cur = l1, w = w1;
    for (const word of words) {
      const len = cur.length ? cur.join(" ").length + 1 + word.length : word.length;
      if (len <= w) cur.push(word);
      else if (cur === l1) { cur = l2; w = w2; if (word.length <= w) l2.push(word); else { l1.push(word.slice(0, w1 - l1.join(" ").length - 1) + "…"); break; } }
      else { l2.push(word.slice(0, w - l2.join(" ").length - 1) + "…"); break; }
    }
    return [l1.join(" "), l2.join(" ")];
  };

  const line = (s, i) => {
    const icon = s.running ? "●" : s.state === "done" ? "✓" : s.state === "ready_for_user_review" ? "◆" : "○";
    const label = ((LABEL[s.state] ?? s.state) + (s.running ? "*" : "")).padStart(10);
    const verdict = ` r${s.retries}${s.lastReview ? (s.lastReview.verdict === "PASS" ? "✓" : "✗") : " "}`;
    const head = ` ${icon} ${s.id} `;
    const mk = (key, body) => h(Text, { key, wrap: false, bold: i === sel,
      color: i === sel ? "#0F1117" : (STATE_COLORS[s.state] ?? C.text), backgroundColor: rowBg(i) }, body);
    const [t1, t2] = wrapTitle(s.title, titleW, titleW - head.length);
    const spacer = Math.max(2, titleW + 1 - t1.length);
    const rows = [mk(s.id, `${head}${t1}${" ".repeat(spacer)}${label}${verdict}`)];
    if (t2) rows.push(mk(s.id + ":2", `${" ".repeat(head.length)}${t2}`));
    return rows;
  };

  const rows = stdout?.rows || 30;
  const footerH = 3;                                  // title bar + status + controls
  const paneH = Math.max(6, rows - footerH);
  const listH = paneH - 4;
  const start = filtered.length <= listH ? 0
    : Math.max(0, Math.min(sel - (listH >> 1), filtered.length - listH));
  const visible = filtered.slice(start, start + listH);

  const filterInfo = filter.status !== "all" || filter.text
    ? ` · filter: ${filter.status !== "all" ? filter.status : ""}${filter.text ? ` "${filter.text}"` : ""} (${filtered.length}/${storiesAll.length})` : "";

  // ── detail view: fixed header + scrollable document ──
  const detailLines = (v) => {
    const st = storiesAll.find(x => x.id === v.id);
    if (!st) return ["(story disappeared)"];
    const doc = v.docs[v.di];
    if (doc.name === "Details") return [
      `${st.id} · ${st.title}`,
      `state      ${st.state}${st.running ? " (running)" : ""}`,
      `retries    ${st.retries}`,
      `branch     ${st.branch}`,
      `worktree   ${st.worktree}`,
      `created    ${st.createdAt}`,
      st.lastReview ? `review     ${st.lastReview.verdict} — ${st.lastReview.file}` : "review     (none yet)",
      st.error ? `error      ${st.error}` : "",
      "",
      `phases: ${st.log.map(l => l.phase).join(" → ") || "none yet"}`,
      "",
      "── documents ──",
      ...v.docs.filter(d => d.name !== "Details").map(d => `  ${d.name}: ${d.lines ? d.lines.length + " lines" : "live"}`),
    ].filter(x => x !== "");
    if (doc.name === "Log") return [
      `── log tail (last phase: ${st.log[st.log.length - 1]?.phase ?? "none"}) ──`,
      ...(state.tails?.[st.id] || "(no log output)").split("\n"),
    ];
    return doc.lines ?? [];
  };
  // helper for scroll clamping (detailView.lines referenced in useInput)
  detailView && (detailView.lines = detailLines);

  const hints = composer
    ? `${composer.kind} ▸ ${composer.buf}▌   ⏎ apply · esc cancel`
    : chat
    ? "type message · ⏎ send · esc close chat"
    : mode === "detail"
    ? "←→ document · ↑↓ scroll · esc back · c chat · q quit"
    : `↑↓ move · ⏎ open story · f filter · s status${filterInfo ? " · esc clear" : ""} · n new · a approve · r retry · m merge · K kill · c chat · q quit`;

  const Hint = () => hints.split(/(⏎|esc|←→|↑↓|c |f |s |n |a |r |m |K )/g).filter(Boolean).map((p, i) =>
    /^[a-zA-Z⏎←↑]|esc/.test(p) && p.length <= 3 ? h(Text, { key: i, color: C.accent }, p) : h(Text, { key: i, color: C.dim }, p));

  const titleRight = `${state.runningIds.length}/${storiesAll.length} stories · port ${port} `;

  return h(Box, { flexDirection: "column", height: rows, backgroundColor: C.bg },
    h(Box, { height: 1, backgroundColor: C.panel },
      h(Text, { bold: true, color: C.accent, wrap: false }, ` ◆ synod-lite · ${mode === "list" ? "stories" : (detailView?.id ?? "detail")}${" ".repeat(Math.max(1, cols - 13 - (mode === "list" ? 7 : (detailView?.id.length + 2)) - titleRight.length - 2))}`),
      h(Text, { color: C.dim, wrap: false }, titleRight)),
    h(Box, { flexDirection: "row", height: paneH },
      mode === "list"
        ? h(Box, { borderStyle: "single", borderColor: C.border, backgroundColor: C.panel, flexDirection: "column", width: mainW },
            h(Box, { flexDirection: "row" },
              h(Text, { bold: true, color: C.text, wrap: false }, " Stories ("),
              h(Text, { bold: true, color: C.accent, wrap: false }, String(filtered.length)),
              h(Text, { bold: true, color: C.text, wrap: false }, ")"),
              filterInfo ? h(Text, { color: C.yellow, wrap: false }, fit(filterInfo, mainInner - 14)) : null),
            start > 0 ? h(Text, { color: C.dim, wrap: false }, ` ↑ ${start} more`) : null,
            ...visible.flatMap(line),
            (start + listH < filtered.length) ? h(Text, { color: C.dim, wrap: false }, ` ↓ ${filtered.length - start - listH} more`) : null,
            h(Box, { flexGrow: 1 }),
            h(Text, { color: C.dim }, ` ${state.runningIds.length} running · workers ${state.config.workers} · auto ${state.config.auto} · trunk ${state.config.trunk}`))
        : h(Box, { borderStyle: "single", borderColor: C.border, backgroundColor: C.panel, flexDirection: "column", width: mainW },
            detailView
              ? (() => {
                  const st = storiesAll.find(x => x.id === detailView.id);
                  const docH = paneH - 8;
                  const all = detailLines(detailView);
                  const clamped = Math.min(detailView.scroll, Math.max(0, all.length - docH));
                  const win = all.slice(clamped, clamped + docH);
                  const doc = detailView.docs[detailView.di];
                  const lockLine = detailView.locked
                    ? "🔒 spec LOCKED — past spec stage (edits via harness actions only)"
                    : "● spec editable — story not yet in development";
                  return [
                    // fixed header
                    h(Box, { flexDirection: "row", key: "hd" },
                      h(Text, { bold: true, color: C.text, wrap: false }, ` ${detailView.id} · `),
                      h(Text, { bold: true, wrap: false, color: STATE_COLORS[detailView.state] ?? C.text },
                        fit(st?.title ?? "", mainInner - detailView.id.length - 3))),
                    h(Text, { wrap: false, color: STATE_COLORS[detailView.state] ?? C.text, key: "st" },
                      ` state ${detailView.state} · retries ${st?.retries ?? "?"}${st?.lastReview ? ` · review ${st.lastReview.verdict}` : ""}`),
                    h(Text, { wrap: false, color: doc.name === "Spec" ? (detailView.locked ? C.red : C.green) : C.border, key: "lk" },
                      ` ${fit(doc.name === "Spec" ? lockLine : " ".repeat(lockLine.length), mainInner)}`),
                    // doc tabs
                    h(Text, { wrap: false, color: C.dim, key: "tabs" },
                      ` ${detailView.docs.map((d, i) => i === detailView.di ? `[${d.name}]` : ` ${d.name} `).join("│")}`),
                    // scrollable body
                    ...win.map((l, i) => h(Text, { key: "b" + i, wrap: false, color: C.text }, ` ${fit(l, mainInner - 1)}`)),
                    h(Box, { flexGrow: 1 }),
                    h(Text, { color: C.dim, wrap: false }, ` ${clamped}/${all.length} lines · ${detailView.di + 1}/${detailView.docs.length} docs`),
                  ];
                })()
              : h(Text, { color: C.dim }, " (no story)")),
      chat
        ? [h(Box, { width: 2, key: "g" }),
           h(Box, { borderStyle: "single", borderColor: C.accent, backgroundColor: C.panel, flexDirection: "column", width: chatW, key: "cp" },
             h(Text, { bold: true, color: C.accent, wrap: false }, ` Chat · focus ${cur?.id ?? "—"}${mode === "detail" ? ` (${detailView?.docs[detailView.di]?.name})` : ""}`),
             ...chat.msgs.slice(-(paneH - 6)).map((m, i) =>
               h(Text, { key: i, wrap: false, color: m.role === "you" ? C.accent : m.role === "action" ? C.green : C.text },
                 ` ${fit(`${m.role === "you" ? "you ▸ " : m.role === "action" ? "⚡ " : "◂ "}${m.text}`, chatW2)}`)),
             h(Box, { flexGrow: 1 }),
             chat.busy ? h(Text, { color: C.dim }, " thinking…") : null,
             h(Text, { color: C.accent, wrap: false }, ` ▸ ${fit(chat.draft ?? "", chatW2 - 3)}▌`))]
        : null),
    h(Box, { height: 1 },
      composer
        ? h(Text, { color: C.accent, wrap: false }, ` ${hints}`)
        : h(Text, { color: msg.startsWith("✗") ? C.red : C.green, wrap: false }, ` ${msg}`)),
    h(Box, { height: 1 }, composer ? null : h(Hint)),
  );
}

export async function runUI(repo, port) {
  if (!(await isDaemonUp(port))) {
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

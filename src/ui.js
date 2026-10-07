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
const softWrap = (t, w) => {
  if (t.length <= w) return [t];
  const out = []; let rest = t;
  while (rest.length > w) {
    const cut = rest.lastIndexOf(" ", w);
    if (cut <= 0) { out.push(rest.slice(0, w)); rest = rest.slice(w); } // no space: hard break (ascii art)
    else { out.push(rest.slice(0, cut)); rest = rest.slice(cut + 1); }
  }
  out.push(rest);
  return out;
};

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
  const [confirm, setConfirm] = useState(null);       // { label, run, onReject } — y/N gate for destructive actions
  const seenProposal = { at: 0 };

  useEffect(() => {
    const iv = setInterval(() => fetchState(port).then(r => {
      setState(r);
      // agent-proposed action (reset) arrives as a confirm bar — show once
      if (r.pendingProposal && r.pendingProposal.at !== seenProposal.at) {
        seenProposal.at = r.pendingProposal.at;
        const p = r.pendingProposal;
        setConfirm({
          label: `agent proposes: ${p.action} ${p.id} → ${p.args.to}${p.args.code ? " + code wipe" : ""}`,
          run: () => act("proposal", { accept: true }),
          onReject: () => act("proposal", { accept: false }),
        });
      }
    }).catch(() => {}), 1000);
    fetchState(port).then(setState).catch(() => {});
    return () => clearInterval(iv);
  }, [port]);

  // spinner: braille frames (single-cell, row-safe); ticks re-render so elapsed stays live
  const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const [spin, setSpin] = useState(0);
  useEffect(() => { const iv = setInterval(() => setSpin(x => x + 1), 150); return () => clearInterval(iv); }, []);
  const spinFrame = SPIN[spin % SPIN.length];
  const runOf = (id) => state?.runs?.[id];
  const elapsed = (id) => {
    const r = runOf(id); if (!r) return "";
    const sec = Math.max(0, Math.floor((Date.now() - r.startedAt) / 1000));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  };

  const storiesAll = state?.stories ?? [];
  const filtered = storiesAll.filter(s =>
    (filter.status === "all" ? true
      : filter.status === "active" ? !["done", "cancelled"].includes(s.state)
      : s.state === filter.status))
    .filter(s => !filter.text || `${s.id} ${s.title}`.toLowerCase().includes(filter.text.toLowerCase()));
  // scoped to the FILTERED list only — an empty filter must never let an
  // action fall through to a hidden story (P1 #1)
  const cur = filtered.length ? filtered[Math.min(sel, filtered.length - 1)] : undefined;

  const act = useCallback(async (action, args = {}) => {
    if (!cur && action !== "new" && action !== "proposal") {
      setMsg("✗ no story selected (filter has no matches) — esc to clear");
      setTimeout(() => setMsg(""), 4000);
      return;
    }
    try {
      const r = await callDaemon(port, action, action === "new" ? undefined : cur.id, args);
      // outcome notification (P1 #4): merge failures are recorded as
      // state=failed without throwing — never show a blind ✓
      if (r && r.state === "failed") {
        setMsg(`✗ ${action} ${action === "new" ? "" : cur.id} — ${r.error ?? "story failed"}`);
        setTimeout(() => setMsg(""), 5000);
      } else {
        setMsg(`${action} ${action === "new" ? "" : cur.id} ✓${r && r.state ? ` → ${r.state}` : ""}`);
        setTimeout(() => setMsg(""), 2500);
      }
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

  // printable input incl. multi-char paste (P1 #2): real clipboard paste
  // arrives as one long `ch` — strip control chars, accept any length
  const pasteOf = (ch, key) =>
    (ch && !key.ctrl && !key.meta && !key.return && !key.escape && !key.backspace && !key.delete
      ? ch.replace(/[\x00-\x1f\x7f]/g, "") : "");

  useInput((ch, key) => {
    // ── chat open: every printable key goes to the chat buffer ──
    if (chat && !composer) {
      if (key.escape) { setChat(null); return; }
      if (key.return) { const t = (chat.draft ?? "").trim(); if (t) { setChat({ ...chat, draft: "" }); sendChat(t); } return; }
      if (key.backspace || key.delete) { setChat({ ...chat, draft: (chat.draft ?? "").slice(0, -1) }); return; }
      const paste = pasteOf(ch, key);
      if (paste) { setChat({ ...chat, draft: (chat.draft ?? "") + paste }); return; }
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
        else if (composer.kind === "reset") {
          const parts = text.split(/\s+/);
          const to = parts[0], code = parts.includes("code");
          if (["spec", "develop", "review", "mergeable"].includes(to))
            setConfirm({ label: `reset ${cur.id} → ${to}${code ? " + code wipe" : ""}`, run: () => act("reset", { to, code }) });
          else { setMsg("✗ reset: spec | develop | review | mergeable  (+ code)"); setTimeout(() => setMsg(""), 4000); }
        }
        else setFilter(f => ({ ...f, text }));
        return;
      }
      if (key.backspace || key.delete) { setComposer({ ...composer, buf: composer.buf.slice(0, -1) }); return; }
      const paste = pasteOf(ch, key);
      if (paste) { setComposer({ ...composer, buf: (composer.buf + paste).slice(0, 80) }); return; }
      return;
    }
    // ── confirm gate: destructive actions + agent proposals wait for y ──
    if (confirm) {
      if (ch === "y" || ch === "Y" || key.return) { const c = confirm; setConfirm(null); c.run(); return; }
      if (key.escape || ch === "n" || ch === "N") { const c = confirm; setConfirm(null); if (c.onReject) c.onReject(); return; }
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
      case "R": if (cur) setComposer({ kind: "reset", buf: "" }); break;
      case "m": act("merge"); break;
      case "K": if (cur) setConfirm({ label: `kill ${cur.id} (worktree removed)`, run: () => act("kill") }); break;
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
    const r = runOf(s);
    const PHASE4 = { spec: "spec", develop: "dev", review: "rev", merge: "mrg" };
    const icon = s.running ? spinFrame : s.state === "done" ? "✓" : s.state === "ready_for_user_review" ? "◆" : "○";
    const label = s.running
      ? `${PHASE4[r?.phase] ?? "run"} ${elapsed(s.id)}`.padStart(10)
      : (LABEL[s.state] ?? s.state).padStart(10);
    const verdict = ` r${s.retries}${s.lastReview ? (s.lastReview.verdict === "PASS" ? "✓" : "✗") : " "}`;
    const head = ` ${icon} ${s.id} `;
    const mk = (key, body) => h(Text, { key, wrap: false, bold: i === sel,
      color: i === sel ? "#0F1117" : s.running ? C.accent : (STATE_COLORS[s.state] ?? C.text), backgroundColor: rowBg(i) }, body);
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
      st.running
        ? `${spinFrame} LIVE — agent working (${runOf(st.id)?.phase} workflow, ${elapsed(st.id)} elapsed) — updates every second`
        : `── log tail (last phase: ${st.log[st.log.length - 1]?.phase ?? "none"}) ──`,
      ...(state.tails?.[st.id] || "(no log output)").split("\n"),
    ];
    return doc.lines ?? [];
  };
  // helper for scroll clamping (detailView.lines referenced in useInput)
  detailView && (detailView.lines = detailLines);

  // structured hint segments (P1 #3): explicit accent/dim pairs — no regex
  // splitting of a flat string, so nothing can mangle the wording
  const K2 = (t) => [t, true], D2 = (t) => [t, false];
  const hintSegments = composer
    ? [D2(composer.kind === "reset"
        ? `reset ▸ ${composer.buf}▌  (spec|develop|review|mergeable, + code)   `
        : `${composer.kind} ▸ ${composer.buf}▌   `), K2("⏎ apply"), D2(" · "), K2("esc cancel")]
    : chat
    ? [D2("type message · "), K2("⏎ send"), D2(" · "), K2("esc close chat")]
    : mode === "detail"
    ? [K2("←→ document"), D2(" · "), K2("↑↓ scroll"), D2(" · "), K2("esc back"), D2(" · "), K2("c chat"), D2(" · "), K2("q quit")]
    : [K2("↑↓ move"), D2(" · "), K2("⏎ open story"), D2(" · "), K2("f filter"), D2(" · "), K2("s status"),
       ...(filterInfo ? [D2(" · "), K2("esc clear")] : []),
       D2(" · "), K2("n new"), D2(" · "), K2("a approve"), D2(" · "), K2("r retry"), D2(" · "), K2("m merge"),
       D2(" · "), K2("K kill"), D2(" · "), K2("R reset"), D2(" · "), K2("c chat"), D2(" · "), K2("q quit")];
  const Hint = () => {
    // budget-aware render: truncate at SEGMENT boundaries with an ellipsis —
    // never mid-key (P2: 110-col terminals cut "f filter" into "f filte")
    const budget = cols - 2;
    const parts = [];
    let used = 1; // leading space
    for (const [t, accent] of hintSegments) {
      if (used + t.length > budget) {
        if (used + 1 <= budget) parts.push(h(Text, { key: "ell", color: C.dim, wrap: false }, "…"));
        break;
      }
      used += t.length;
      parts.push(h(Text, { key: parts.length, color: accent ? C.accent : C.dim, wrap: false }, t));
    }
    return h(Box, { height: 1 }, ...parts);
  };

  const titleRight = `${state.runningIds.length}/${storiesAll.length} stories · port ${port} `;

  return h(Box, { flexDirection: "column", height: rows, backgroundColor: C.bg },
    h(Box, { height: 1, backgroundColor: C.panel },
      (() => {
        const st = mode === "detail" && detailView ? storiesAll.find(x => x.id === detailView.id) : null;
        const left = ` ◆ synod-lite · ${mode === "list" ? "stories" : detailView ? detailView.id + " · " + (st?.title ?? "") : "detail"}`;
        const l = fit(left, cols - titleRight.length - 1);
        return [
          h(Text, { bold: true, color: C.accent, wrap: false }, fit(` ◆ synod-lite · ${mode === "list" ? "stories" : (detailView?.id ?? "detail")}`, l.length)),
          ...(mode === "detail" && detailView
            ? [h(Text, { bold: true, color: C.text, wrap: false }, fit(` · ${st?.title ?? ""}`, Math.max(0, cols - titleRight.length - 1 - (detailView.id.length + 13))))]
            : [h(Text, { color: C.dim, wrap: false }, " ".repeat(Math.max(1, cols - 13 - 7 - titleRight.length - 2)))]),
          h(Text, { color: C.dim, wrap: false }, mode === "list" ? titleRight : " ".repeat(1)),
        ];
      })()),
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
            // empty-state guidance: never a blank pane
            filtered.length === 0 ? h(Text, { color: C.dim, wrap: false },
              storiesAll.length === 0
                ? " no stories yet — press n to create one"
                : " no matches for this filter — esc to clear") : null,
            (start + listH < filtered.length) ? h(Text, { color: C.dim, wrap: false }, ` ↓ ${filtered.length - start - listH} more`) : null,
            h(Box, { flexGrow: 1 }),
            h(Text, { color: C.dim }, ` ${state.runningIds.length} running · workers ${state.config.workers} · auto ${state.config.auto} · trunk ${state.config.trunk}`))
        : h(Box, { borderStyle: "single", borderColor: C.border, backgroundColor: C.panel, flexDirection: "column", width: mainW },
            detailView
              ? (() => {
                  const st = storiesAll.find(x => x.id === detailView.id);
                  const docH = paneH - 8;
                  const all = detailLines(detailView).flatMap(l => softWrap(l, mainInner - 2));
                  const clamped = Math.min(detailView.scroll, Math.max(0, all.length - docH));
                  const win = all.slice(clamped, clamped + docH);
                  const doc = detailView.docs[detailView.di];
                  const lockLine = detailView.locked
                    ? "× spec LOCKED — past spec stage (edits via harness actions only)"
                    : "● spec editable — story not yet in development";
                  return [
                    // fixed header (title lives in the top bar)
                    detailView && runOf(st) ? h(Text, { wrap: false, color: C.accent, key: "run" },
                      ` ${spinFrame} agent running · ${runOf(st.id)?.phase} workflow · ${elapsed(detailView.id)} elapsed`) : null,
                    h(Text, { wrap: false, color: STATE_COLORS[st?.state ?? detailView.state] ?? C.text, key: "st" },
                      ` state ${st?.state ?? detailView.state} · retries ${st?.retries ?? "?"}${st?.lastReview ? ` · review ${st.lastReview.verdict}` : ""}`),
                    h(Text, { wrap: false, color: doc.name === "Spec" ? (detailView.locked ? C.red : C.green) : C.border, key: "lk" },
                      ` ${fit(doc.name === "Spec" ? lockLine : " ".repeat(lockLine.length), mainInner)}`),
                    // scrollable body — soft-wrapped, never wider than the pane
                    ...win.map((l, i) => h(Text, { key: "b" + i, wrap: false, color: C.text }, ` ${l}`)),
                    h(Box, { flexGrow: 1 }),
                    h(Text, { color: C.dim, wrap: false }, ` ${clamped}/${all.length} lines`),
                    // doc banner: framed strip spanning the exact pane width
                    // row 1: ├────┬────┤   row 2: │ slot │ slot ┤   (pane bottom border closes it)
                    (() => {
                      const W = mainInner;
                      const n = detailView.docs.length;
                      const sum = W - (n - 1);                // only the n-1 separators consume width now                 // 1 leading │ + n-1 separators + 1 trailing ┤
                      const w = [];                          // exact slot widths incl. remainder
                      for (let i = 0; i < n; i++) w.push(Math.floor(sum / n) + (i < sum % n ? 1 : 0));
                      const top = h(Text, { key: "bt", wrap: false, color: C.border },
                        w.map(x => "─".repeat(x)).join("┬"));
                      const row = [];
                      detailView.docs.forEach((d, i) => {
                        const sel = i === detailView.di;
                        const label = sel ? `[${d.name}]` : d.name;
                        const pad = Math.max(0, w[i] - label.length);
                        const lead = Math.floor(pad / 2), trail = pad - lead;
                        row.push(h(Text, { key: "s" + i, wrap: false, bold: sel,
                          color: sel ? C.accent : C.dim }, " ".repeat(lead) + label));
                        if (i < n - 1) row.push(h(Text, { key: "p" + i, wrap: false, color: C.border },
                          " ".repeat(trail) + "│"));
                        else row.push(h(Text, { key: "pl", wrap: false, color: C.border }, " ".repeat(trail)));
                      });
                      return [top, h(Box, { flexDirection: "row", key: "bb" }, ...row)];
                    })(),
                  ];
                })()
              : h(Text, { color: C.dim }, " (no story)")),
      chat
        ? [h(Box, { width: 2, key: "g" }),
           h(Box, { borderStyle: "single", borderColor: C.accent, backgroundColor: C.panel, flexDirection: "column", width: chatW, key: "cp" },
             h(Text, { bold: true, color: C.accent, wrap: false }, ` Chat · focus ${cur?.id ?? "—"}${mode === "detail" ? ` (${detailView?.docs[detailView.di]?.name})` : ""}`),
             ...chat.msgs.slice(-(paneH - 6)).map((m, i) =>
               h(Text, { key: i, wrap: false, color: m.role === "you" ? C.accent : m.role === "action" ? C.green : C.text },
                 ` ${fit(`${m.role === "you" ? "you ▸ " : m.role === "action" ? "+ " : "◂ "}${m.text}`, chatW2)}`)),
             h(Box, { flexGrow: 1 }),
             chat.busy ? h(Text, { color: C.dim }, " thinking...") : null,
             h(Text, { color: C.accent, wrap: false }, ` ▸ ${fit(chat.draft ?? "", chatW2 - 3)}▌`))]
        : null),
    h(Box, { height: 1 },
      composer
        ? h(Text, { color: C.accent, wrap: false }, ` ${composer.kind} ▸ ${composer.buf}▌${composer.kind === "reset" ? "   (spec|develop|review|mergeable, + code)" : ""}`)
        : h(Text, { color: msg.startsWith("✗") ? C.red : C.green, wrap: false }, ` ${fit(msg, cols - 2)}`)),
    h(Box, { height: 1 },
      confirm
        ? [h(Text, { color: C.yellow, wrap: false }, ` ? ${confirm.label} — `),
           h(Text, { bold: true, color: C.accent, wrap: false }, "y confirm"),
           h(Text, { color: C.yellow, wrap: false }, " · "),
           h(Text, { color: C.dim, wrap: false }, "esc cancel")]
        : composer ? null : h(Hint)),
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

// width-aware agents: the TUI reports terminal cols; agents size ASCII art to fit
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../src/core/config.ts";
import { Store } from "../src/core/store.ts";
import { handleAction, buildChatPrompt, startDaemon } from "../src/daemon.ts";
import { docWidthNote } from "../src/core/machine.ts";

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-w-"));
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  execFileSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-m", "init"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "pi-fake.sh"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(dir, "pi-fake.sh"), 0o755);
  fs.writeFileSync(path.join(dir, ".synod-lite.json"), JSON.stringify({
    piBin: path.join(dir, "pi-fake.sh"), provider: "local", model: "t", workers: 0,
    maxRetries: 3, auto: "spec", trunk: "main", timeoutMs: 5000, daemonPort: 0,
  }));
  return dir;
}

async function rig() {
  const repo = mkRepo();
  const ctx = { repo, cfg: loadConfig(repo), store: new Store(repo) };
  await handleAction(ctx, "new", undefined, { title: "Wide art" });
  return ctx;
}

test("docWidthNote caps agent line width to the reported terminal", () => {
  assert.match(docWidthNote({}), /width="72"/);           // default 80 - 8
  assert.match(docWidthNote({ uiCols: 110 }), /width="102"/);  // actual TUI width
  assert.match(docWidthNote({ uiCols: 10 }), /width="40"/);    // sane floor
});

test("chat prompt tells the agent real pane widths", async () => {
  const ctx = await rig();
  const p80 = buildChatPrompt(ctx, "hi");
  assert.match(p80, /<terminal_columns>80<\/terminal_columns>/);
  assert.match(p80, /TRUNCATES lines longer than 22 columns/);   // floor(80*.36)-6
  ctx.uiCols = 110;
  const p110 = buildChatPrompt(ctx, "hi");
  assert.match(p110, /<terminal_columns>110<\/terminal_columns>/);
  assert.match(p110, /TRUNCATES lines longer than 33 columns/);
});

test("POST /ui stores terminal width and /state exposes it", async () => {
  const repo = mkRepo();
  const cfg = loadConfig(repo);
  const d = await startDaemon(repo, cfg);
  try {
    let r = await fetch(`http://127.0.0.1:${d.port}/ui`, { method: "POST", body: JSON.stringify({ cols: 132 }) });
    assert.equal(r.status, 200);
    r = await fetch(`http://127.0.0.1:${d.port}/state`);
    const st = await r.json();
    assert.equal(st.uiCols, 132);
    // garbage rejected, width untouched
    await fetch(`http://127.0.0.1:${d.port}/ui`, { method: "POST", body: "nonsense" });
    const st2 = await (await fetch(`http://127.0.0.1:${d.port}/state`)).json();
    assert.equal(st2.uiCols, 132);
  } finally { await d.stop(); }
});

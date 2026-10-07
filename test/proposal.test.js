// reset proposals: the chat agent may request a reset, but it NEVER executes
// directly — it becomes a pending proposal the operator must accept.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../src/core/config.ts";
import { Store } from "../src/core/store.ts";
import { handleAction, buildChatPrompt } from "../src/daemon.ts";

function mkRepo(piScript) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-prop-"));
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  execFileSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-m", "init"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "pi-fake.sh"), piScript);
  fs.chmodSync(path.join(dir, "pi-fake.sh"), 0o755);
  fs.writeFileSync(path.join(dir, ".synod-lite.json"), JSON.stringify({
    piBin: path.join(dir, "pi-fake.sh"), provider: "local", model: "t", workers: 0,
    maxRetries: 3, auto: "spec", trunk: "main", timeoutMs: 5000, daemonPort: 0,
  }));
  return dir;
}

const PI_RESET = `#!/usr/bin/env bash
echo "Sure — resetting it."
echo "ACTION: reset S-001 --to spec"
`;

async function rig(piScript = PI_RESET) {
  const repo = mkRepo(piScript);
  const ctx = { repo, cfg: loadConfig(repo), store: new Store(repo) };
  await handleAction(ctx, "new", undefined, { title: "Proposal target" });
  await ctx.store.update("S-001", { state: "in_review" });
  return ctx;
}

test("agent reset ACTION becomes a proposal, never executes directly", async () => {
  const ctx = await rig();
  const r = await handleAction(ctx, "chat", undefined, { message: "reset S-001 to spec please" });
  assert.equal(r.action, "reset S-001 --to spec");
  assert.match(r.actionResult, /proposed|confirm/);
  assert.ok(ctx.pending, "pending proposal stored");
  assert.equal(ctx.pending.id, "S-001");
  assert.equal(ctx.pending.args.to, "spec");
  assert.equal(ctx.store.get("S-001").state, "in_review", "story NOT reset yet");
});

test("accepting the proposal executes the reset", async () => {
  const ctx = await rig();
  await handleAction(ctx, "chat", undefined, { message: "reset S-001 to spec please" });
  const r = await handleAction(ctx, "proposal", undefined, { accept: true });
  assert.equal(r.state, "drafted");
  assert.equal(ctx.pending, undefined, "proposal cleared");
});

test("rejecting the proposal leaves the story untouched", async () => {
  const ctx = await rig();
  await handleAction(ctx, "chat", undefined, { message: "reset S-001 to spec please" });
  const r = await handleAction(ctx, "proposal", undefined, { accept: false });
  assert.equal(r.resolved, "rejected");
  assert.equal(ctx.store.get("S-001").state, "in_review");
  assert.equal(ctx.pending, undefined);
});

test("proposal with nothing pending errors", async () => {
  const ctx = await rig();
  await assert.rejects(handleAction(ctx, "proposal", undefined, { accept: true }), /no pending proposal/);
});

test("app guide (wiki) is part of every chat prompt", async () => {
  const ctx = await rig();
  const p = buildChatPrompt(ctx, "how does this app work?", null);
  assert.match(p, /<app_guide>/);
  assert.match(p, /<lifecycle>drafted/);
  assert.match(p, /<human_gates/);
  assert.match(p, /<tui_keys/);
  assert.match(p, /ACTION: reset <id> --to/);
});

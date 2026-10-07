// Capability check: buildChatPrompt gives the chat agent page-aware context
// matching (at least) what the operator sees. Pure-function tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../src/core/config.ts";
import { Store } from "../src/core/store.ts";
import { buildChatPrompt } from "../src/daemon.ts";

function mkRig() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "sl-chat-"));
  fs.writeFileSync(path.join(repo, ".synod-lite.json"), JSON.stringify({
    piBin: "/bin/true", provider: "local", model: "test", workers: 2,
    maxRetries: 3, auto: "spec", trunk: "main", timeoutMs: 5000, daemonPort: 0,
  }));
  const wt = path.join(repo, "wt-s001/.dev-agents");
  fs.mkdirSync(path.join(wt, "specs"), { recursive: true });
  fs.mkdirSync(path.join(wt, "output"), { recursive: true });
  fs.writeFileSync(path.join(wt, "specs/feat.md"), "# Spec for string utils\nAC1: trim works\n");
  fs.writeFileSync(path.join(wt, "specs/test-design-feat.md"), "# Test design\nCASE: trims spaces\n");
  fs.writeFileSync(path.join(wt, "output/review-feat.md"), "# Review\n## Gate decision — FAIL: AC1 not met\nDislikes trailing spaces\n");
  fs.mkdirSync(path.join(repo, ".synod-lite/logs"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".synod-lite/logs/s001-implement.log"), "start\nworking on trim\nimplemented AC1\n");
  const now = new Date().toISOString();
  const stories = [
    {
      id: "S-001", title: "String utils", state: "in_development", branch: "story/s-001",
      worktree: "wt-s001", retries: 1, createdAt: now, updatedAt: now, approved: true,
      lastReview: { verdict: "FAIL", file: "review-feat.md", at: now },
      log: [
        { phase: "spec", at: now, file: ".synod-lite/logs/s001-spec.log" },
        { phase: "test-design", at: now, file: ".synod-lite/logs/s001-td.log" },
        { phase: "implement", at: now, file: ".synod-lite/logs/s001-implement.log" },
      ],
    },
    {
      id: "S-002", title: "Csv parse", state: "ready_for_user_review", branch: "story/s-002",
      worktree: "wt-s002", retries: 0, createdAt: now, updatedAt: now, approved: false, log: [],
    },
  ];
  fs.mkdirSync(path.join(repo, ".synod-lite"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".synod-lite/state.json"), JSON.stringify({ stories, nextSeq: 3 }));
  const ctx = { repo, cfg: loadConfig(repo), store: new Store(repo), running: new Map() };
  return ctx;
}

const ctx = mkRig();
const S1 = () => ctx.store.get("S-001");

test("board snapshot: verdicts + live run status (monitoring)", () => {
  ctx.running.set("S-001", { startedAt: Date.now() - 65000, phase: "develop" });
  const p = buildChatPrompt(ctx, "status?", null);
  assert.match(p, /S-001 .* review:FAIL \[running develop workflow, 1m0[0-9]s elapsed\]/);
  assert.match(p, /Daemon: workers 2, auto spec, trunk main\./);
  assert.match(p, /S-002 .*ready_for_user_review r0/);
  ctx.running.delete("S-001");
});

test("focus Details block: branch, phases, error, review", () => {
  ctx.running.set("S-001", { startedAt: Date.now() - 65000, phase: "develop" });
  const p = buildChatPrompt(ctx, "hi", S1(), "Details");
  assert.match(p, /state in_development \[running develop workflow/); // focus carries run info too
  assert.match(p, /branch story\/s-001/);
  assert.match(p, /phases so far: spec → test-design → implement/);
  assert.match(p, /last review FAIL — review-feat\.md/);
  assert.match(p, /on the Details page/);
  assert.match(p, /spec is LOCKED/); // in_development → locked advice
});

test("focus failure state surfaces error text", async () => {
  await ctx.store.update("S-001", { state: "failed", error: "develop phase exited 1 (see logs)" });
  const p = buildChatPrompt(ctx, "hi", ctx.store.get("S-001"), undefined);
  assert.match(p, /error develop phase exited 1/);
  await ctx.store.update("S-001", { state: "in_development", error: undefined });
});

test("doc pages inject the exact viewed document", () => {
  assert.match(buildChatPrompt(ctx, "hi", S1(), "Spec"), /# Spec for string utils/);
  assert.match(buildChatPrompt(ctx, "hi", S1(), "Test design"), /# Test design\nCASE: trims spaces/);
  assert.match(buildChatPrompt(ctx, "hi", S1(), "Review"), /Gate decision — FAIL: AC1 not met/);
  const log = buildChatPrompt(ctx, "hi", S1(), "Log");
  assert.match(log, /viewing the live agent log \(phase implement/);
  assert.match(log, /implemented AC1/); // tail of newest log file
});

test("editable-spec advice for pre-development story", () => {
  const p = buildChatPrompt(ctx, "hi", ctx.store.get("S-002"), undefined);
  assert.match(p, /spec is still editable/);
});

test("action contract: whitelist + human gates, always", () => {
  for (const doc of ["Spec", "Review", "Log", "Details", undefined]) {
    const p = buildChatPrompt(ctx, "hi", S1(), doc);
    assert.match(p, /ACTION: new "<title>"/);
    assert.match(p, /ACTION: retry <id>/);
    assert.match(p, /ACTION: kill <id>/);
    assert.match(p, /approve and merge are human gates/);
    assert.match(p, /Operator: hi$/);
  }
});

// story reset: phase reset + optional code (branch) reset. Direct handleAction tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../src/core/config.ts";
import { Store } from "../src/core/store.ts";
import { handleAction } from "../src/daemon.ts";

const ROOT = path.join(import.meta.dirname, "..");

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-reset-"));
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "trunk version\n");
  execFileSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-m", "init"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, ".synod-lite.json"), JSON.stringify({
    piBin: "/bin/true", provider: "local", model: "t", workers: 0,
    maxRetries: 3, auto: "spec", trunk: "main", timeoutMs: 5000, daemonPort: 0,
  }));
  return dir;
}

function rig() {
  const repo = mkRepo();
  const cfg = loadConfig(repo);
  const store = new Store(repo);
  return { ctx: { repo, cfg, store }, repo };
}

const commitIn = (wt, file, content) => {
  fs.writeFileSync(path.join(wt, file), content);
  execFileSync("git", ["-C", wt, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", wt, "commit", "-m", "wip"], { stdio: "ignore" });
};

test("reset to a phase: state mapping, retries/error cleared", async () => {
  const { ctx, repo } = rig();
  const s = await handleAction(ctx, "new", undefined, { title: "Reset target" });
  const st = ctx.store.get(s.id);
  await ctx.store.update(s.id, { state: "blocked", retries: 3, approved: true, error: "review FAIL after 3 retries" });
  const r = await handleAction(ctx, "reset", s.id, { to: "develop" });
  assert.equal(r.state, "in_development");
  assert.equal(r.retries, 0);
  assert.equal(r.error, undefined);
  assert.equal(r.approved, true); // daemon-runnable
  await handleAction(ctx, "reset", s.id, { to: "spec" });
  assert.equal(ctx.store.get(s.id).state, "drafted");
  assert.equal(ctx.store.get(s.id).approved, false);
});

test("reset with code: story branch hard-reset to trunk", async () => {
  const { ctx } = rig();
  const s = await handleAction(ctx, "new", undefined, { title: "Code reset" });
  const wt = path.join(ctx.repo, ctx.store.get(s.id).worktree);
  commitIn(wt, "feature.js", "export const x = 1;\n");
  assert.ok(fs.existsSync(path.join(wt, "feature.js")));
  await ctx.store.update(s.id, { state: "failed", error: "develop phase exited 1" });
  await handleAction(ctx, "reset", s.id, { to: "spec", code: true });
  assert.ok(!fs.existsSync(path.join(wt, "feature.js")), "committed file must be gone after code reset");
  assert.equal(fs.readFileSync(path.join(wt, "README.md"), "utf8"), "trunk version\n");
  assert.equal(ctx.store.get(s.id).state, "drafted");
});

test("reset guards: invalid target, done, cancelled, running", async () => {
  const { ctx } = rig();
  const s = await handleAction(ctx, "new", undefined, { title: "Guards" });
  await assert.rejects(handleAction(ctx, "reset", s.id, { to: "warp" }), /invalid reset target/);
  await ctx.store.update(s.id, { state: "done" });
  await assert.rejects(handleAction(ctx, "reset", s.id, { to: "spec" }), /done \(already merged/);
  const s2 = await handleAction(ctx, "new", undefined, { title: "Cancelled" });
  await handleAction(ctx, "kill", s2.id);
  await assert.rejects(handleAction(ctx, "reset", s2.id, { to: "spec" }), /cancelled/);
  const s3 = await handleAction(ctx, "new", undefined, { title: "Running" });
  ctx.running = new Map([[s3.id, { startedAt: Date.now(), phase: "spec" }]]);
  await assert.rejects(handleAction(ctx, "reset", s3.id, { to: "review" }), /is running/);
});

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synod-lite-"));
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "test repo\n");
  execFileSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-m", "init"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, ".gitignore"), "fake-pi.sh\n.synod-lite.json\n.synod-lite/\n");
  execFileSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-m", "setup"], { stdio: "ignore" });
  fs.copyFileSync(path.join(ROOT, "test/fake-pi.sh"), path.join(dir, "fake-pi.sh"));
  fs.chmodSync(path.join(dir, "fake-pi.sh"), 0o755);
  fs.writeFileSync(path.join(dir, ".synod-lite.json"), JSON.stringify({
    piBin: path.join(dir, "fake-pi.sh"), provider: "local", model: "test-model", workers: 2,
    maxRetries: 3, auto: "spec", trunk: "main", timeoutMs: 30000, daemonPort: 0,
  }));
  return dir;
}

function synodLite(repo, ...args) {
  return execFileSync(process.execPath, [path.join(ROOT, "bin/synod-lite.js"), ...args], {
    cwd: repo, encoding: "utf8",
  });
}
const state = repo => JSON.parse(fs.readFileSync(path.join(repo, ".synod-lite/state.json"), "utf8"));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(repo, id, pred, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = state(repo).stories.find(x => x.id === id);
    if (s && pred(s)) return s;
    await wait(150);
  }
  throw new Error(`timeout waiting for ${id}: ${JSON.stringify(state(repo).stories.find(x => x.id === id))}`);
}

  test("full pipeline: new → ready_for_user_review → approve → done → merge", async () => {
  const repo = mkRepo();
  synodLite(repo, "new", "feature alpha");
  synodLite(repo, "step", "S-001"); // spec phase (no daemon in this test)
  const s1 = await waitFor(repo, "S-001", s => s.state === "ready_for_user_review");
  assert.equal(s1.approved, false, "spec gate waits for approval");
  assert.ok(fs.existsSync(path.join(repo, s1.worktree, ".dev-agents/specs/fake-feature.md")), "spec written in worktree");

  // step must refuse before approval
  let refused = false;
  try { synodLite(repo, "step", "S-001"); } catch { refused = true; }
  assert.ok(refused, "step refuses when spec not approved");
  // approve, then step through develop+review manually (no daemon in test)
  synodLite(repo, "approve", "S-001");
  synodLite(repo, "step", "S-001"); // develop (test-design + implement) → in_review
  await waitFor(repo, "S-001", s => s.state === "in_review");
  synodLite(repo, "step", "S-001"); // review → done
  const done = await waitFor(repo, "S-001", s => s.state === "ready_for_merge");
  assert.equal(done.lastReview.verdict, "PASS");

  synodLite(repo, "merge", "S-001");
  const merged = await waitFor(repo, "S-001", s => s.state === "done");
  assert.equal(merged.state, "done");
  const log = execFileSync("git", ["-C", repo, "log", "--oneline", "-1"], { encoding: "utf8" }).trim();
  assert.match(log, /S-001: feature alpha/);
  assert.ok(!fs.existsSync(path.join(repo, merged.worktree)), "worktree removed after merge");
});

test("review FAIL → auto retry with feedback → PASS (flaky)", async () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, ".synod-lite.json"), JSON.stringify({
    piBin: path.join(repo, "fake-pi.sh"), provider: "local", model: "m", workers: 2, maxRetries: 3,
    auto: "spec", trunk: "main", timeoutMs: 30000, daemonPort: 0,
  }));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpi-"));
  fs.writeFileSync(path.join(stateDir, "review-count"), "0");
  process.env.FAKE_PI_MODE = "flaky"; process.env.FAKE_PI_STATE = stateDir;
  try {
    synodLite(repo, "new", "flaky feature");
    synodLite(repo, "step", "S-001");
    await waitFor(repo, "S-001", s => s.state === "ready_for_user_review");
    synodLite(repo, "approve", "S-001");
    synodLite(repo, "step", "S-001");
    await waitFor(repo, "S-001", s => s.state === "in_review");
    synodLite(repo, "step", "S-001");
    // flaky: first review FAILs → story back to ready_for_user_review(approved) with retries=1
    const retrying = await waitFor(repo, "S-001", s => s.state === "ready_for_user_review" && s.retries === 1);
    assert.ok(retrying.approved, "auto-retry re-enters development");
    synodLite(repo, "step", "S-001"); await waitFor(repo, "S-001", s => s.state === "in_review");
    synodLite(repo, "step", "S-001");
    const done = await waitFor(repo, "S-001", s => s.state === "ready_for_merge");
    assert.equal(done.retries, 1);
    assert.equal(done.lastReview.verdict, "PASS");
  } finally {
    delete process.env.FAKE_PI_MODE; delete process.env.FAKE_PI_STATE;
  }
});

test("daemon drives the pipeline autonomously", async () => {
  const repo = mkRepo();
  // pick a free port for this daemon instance
  const port = 40000 + Math.floor(Math.random() * 20000);
  const { loadConfig } = await import(path.join(ROOT, "src/core/config.ts"));
  const cfg = loadConfig(repo); // merges DEFAULTS (worktreeRoot etc.)
  cfg.daemonPort = port; fs.writeFileSync(path.join(repo, ".synod-lite.json"), JSON.stringify(cfg));

  const { startDaemon } = await import(path.join(ROOT, "src/daemon.ts"));
  const d = await startDaemon(repo, cfg);
  try {
    const { callDaemon } = await import(path.join(ROOT, "src/daemon.ts"));
    await callDaemon(port, "new", undefined, { title: "daemon feature" });
    await waitFor(repo, "S-001", s => s.state === "ready_for_user_review");
    await callDaemon(port, "approve", "S-001");
    const done = await waitFor(repo, "S-001", s => s.state === "ready_for_merge", 20000);
    assert.equal(done.lastReview.verdict, "PASS");
  } finally { await d.stop(); }
});

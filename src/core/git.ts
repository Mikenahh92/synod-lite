import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function ensureTrunk(repo: string, trunk: string) {
  const branches = git(repo, "branch", "--format", "%(refname:short)").split("\n").map(s => s.trim());
  if (!branches.includes(trunk)) {
    if (git(repo, "rev-parse", "--verify", `origin/${trunk}`)) git(repo, "branch", trunk, `origin/${trunk}`);
    else throw new Error(`trunk branch '${trunk}' does not exist`);
  }
}

export function createWorktree(repo: string, branch: string, wtRel: string, trunk: string): void {
  ensureTrunk(repo, trunk);
  const abs = path.join(repo, wtRel);
  if (fs.existsSync(abs)) throw new Error(`worktree path already exists: ${wtRel}`);
  git(repo, "worktree", "add", "-b", branch, abs, trunk);
}

export function removeWorktree(repo: string, wtRel: string, branch?: string): void {
  const abs = path.join(repo, wtRel);
  try { git(repo, "worktree", "remove", "--force", abs); } catch { /* already gone */ }
  if (branch) { try { git(repo, "branch", "-D", branch); } catch { /* ignore */ } }
}

// hard-reset a story branch back to the trunk tip — discards ALL commits on
// the story branch (used by story reset with code reset). Docs in the
// worktree (.dev-agents) are left in place as history.
export function resetWorktreeToTrunk(repo: string, wtRel: string, trunk: string): void {
  const abs = path.join(repo, wtRel);
  if (!fs.existsSync(abs)) throw new Error(`worktree missing: ${wtRel}`);
  git(abs, "reset", "--hard", trunk);
}

export function isClean(repo: string): boolean {
  return git(repo, "status", "--porcelain") === "";
}

export function squashMerge(repo: string, branch: string, trunk: string, id: string, title: string): void {
  if (!isClean(repo)) throw new Error(`repo root has uncommitted changes; commit or stash before merging ${id}`);
  const cur = git(repo, "rev-parse", "--abbrev-ref", "HEAD");
  if (cur !== trunk) git(repo, "checkout", trunk);
  try {
    git(repo, "merge", "--squash", branch);
    git(repo, "commit", "-m", `${id}: ${title}`);
  } catch (e) {
    try { git(repo, "merge", "--abort"); } catch { /* no merge in progress */ }
    try { git(repo, "reset", "--hard", "HEAD"); } catch { /* ignore */ }
    throw e;
  } finally {
    if (cur !== trunk) git(repo, "checkout", cur);
  }
}

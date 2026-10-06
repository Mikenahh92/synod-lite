import fs from "node:fs";
import path from "node:path";

export type AutoMode = "spec" | "review" | "full";

export interface PitbossConfig {
  piBin: string;
  provider: string;
  model: string;
  workers: number;
  maxRetries: number;
  auto: AutoMode;
  worktreeRoot: string;
  daemonPort: number;
  trunk: string;
  timeoutMs: number;
}

export const DEFAULTS: PitbossConfig = {
  piBin: "pi",
  provider: "local",
  model: "",
  workers: 2,
  maxRetries: 3,
  auto: "spec",
  worktreeRoot: ".pitboss/worktrees",
  daemonPort: 8799,
  trunk: "main",
  timeoutMs: 30 * 60 * 1000,
};

export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no git repo found upward from ${start}`);
    dir = parent;
  }
}

export function loadConfig(repoRoot: string): PitbossConfig {
  const file = path.join(repoRoot, ".pitboss.json");
  const cfg = { ...DEFAULTS };
  if (fs.existsSync(file)) Object.assign(cfg, JSON.parse(fs.readFileSync(file, "utf8")));
  fs.mkdirSync(path.join(repoRoot, cfg.worktreeRoot), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, ".pitboss", "logs"), { recursive: true });
  return cfg;
}

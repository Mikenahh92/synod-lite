import fs from "node:fs";
import path from "node:path";

export type StoryState =
  | "created" | "speccing" | "spec_ready"
  | "developing" | "reviewing"
  | "done" | "needs_human" | "failed"
  | "merging" | "merged" | "killed";

export interface Story {
  id: string;
  title: string;
  state: StoryState;
  branch: string;
  worktree: string; // relative to repo root
  retries: number;
  createdAt: string;
  updatedAt: string;
  phaseStartedAt?: string;
  approved: boolean;
  error?: string;
  lastReview?: { verdict: "PASS" | "FAIL"; file: string; at: string };
  log: { phase: string; at: string; file: string }[];
}

interface StateFile { stories: Story[]; nextSeq: number }

const ACTIVE: StoryState[] = ["speccing", "developing", "reviewing", "merging"];
export const isActive = (s: Story) => ACTIVE.includes(s.state);
export const isRunnable = (s: Story) => s.state === "created" || (s.state === "spec_ready" && s.approved);

export class Store {
  private repoRoot: string;
  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    fs.mkdirSync(path.join(repoRoot, ".pitboss"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, ".pitboss", "logs"), { recursive: true });
  }
  private file = () => path.join(this.repoRoot, ".pitboss", "state.json");
  private lockDir = () => path.join(this.repoRoot, ".pitboss", ".lock");

  private readRaw(): StateFile {
    const f = this.file();
    if (!fs.existsSync(f)) return { stories: [], nextSeq: 1 };
    return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  private writeRaw(st: StateFile) {
    const f = this.file();
    fs.writeFileSync(f + ".tmp", JSON.stringify(st, null, 2));
    fs.renameSync(f + ".tmp", f);
  }

  async withLock<T>(fn: (st: StateFile) => T | Promise<T>): Promise<T> {
    const lock = this.lockDir();
    const deadline = Date.now() + 5000;
    while (true) {
      try { fs.mkdirSync(lock); break; }
      catch {
        // steal stale locks (crashed process)
        try {
          const age = Date.now() - fs.statSync(lock).mtimeMs;
          if (age > 1500) { fs.rmdirSync(lock); continue; }
        } catch {}
        if (Date.now() > deadline) throw new Error("pitboss state lock timeout");
        await sleep(50);
      }
    }
    try {
      const st = this.readRaw();
      const out = await fn(st);
      this.writeRaw(st);
      return out;
    } finally { try { fs.rmdirSync(lock); } catch {} }
  }

  stories(): Story[] { return this.readRaw().stories; }
  get(id: string): Story | undefined {
    return this.stories().find(s => s.id.toLowerCase() === id.toLowerCase() || s.branch.endsWith(id));
  }
  nextId(): string {
    return this.withLock(st => { const id = `S-${String(st.nextSeq).padStart(3, "0")}`; st.nextSeq++; return id; });
  }
  async update(id: string, patch: Partial<Story>): Promise<Story> {
    return this.withLock(async st => {
      const s = st.stories.find(x => x.id === id);
      if (!s) throw new Error(`story ${id} not found`);
      Object.assign(s, patch, { updatedAt: new Date().toISOString() });
      return { ...s };
    });
  }
  async add(story: Story) {
    await this.withLock(st => { st.stories.push(story); });
  }
  logFile(id: string, phase: string, n: number): string {
    const dir = path.join(this.repoRoot, ".pitboss", "logs", id);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${phase}-${n}.log`);
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

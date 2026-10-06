import { spawn } from "node:child_process";
import fs from "node:fs";
import { type PitbossConfig } from "./config.ts";

export interface RunResult { code: number; durationMs: number }

const PROXY_VARS = ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"];

export async function runPi(
  cfg: PitbossConfig,
  cwd: string,
  prompt: string,
  logFile: string,
): Promise<RunResult> {
  const args = ["-p", prompt];
  if (cfg.provider) args.push("--provider", cfg.provider);
  if (cfg.model) args.push("--model", cfg.model);

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const v of PROXY_VARS) delete env[v];

  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile, { flags: "w" });
    const t0 = Date.now();
    const child = spawn(cfg.piBin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let cancelled = false;
    const timer = setTimeout(() => {
      cancelled = true;
      out.write(`\n[synod-lite] timeout after ${cfg.timeoutMs}ms — killing\n`);
      child.kill("SIGKILL");
    }, cfg.timeoutMs);
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      resolve({ code: cancelled ? 124 : (code ?? 1), durationMs: Date.now() - t0 });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      out.write(`\n[synod-lite] spawn error: ${err.message}\n`);
      out.end();
      resolve({ code: 127, durationMs: Date.now() - t0 });
    });
  });
}

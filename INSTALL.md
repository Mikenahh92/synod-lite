# Installing synod-lite

synod-lite is a story harness around [pi](https://github.com/earendil-works/pi) (a headless coding agent) plus a dev-agents workflow. The harness — not the agents — owns all story state, branches, and gates.

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node ≥ 22** (24 recommended) | runs the TypeScript sources directly via native type-stripping — no build step |
| **git** | stories live in branches + worktrees of your project repo |
| **pi** (`earendil-works/pi`) on PATH | the agent runner; see its README for install + provider setup |
| **A dev-agents workflow** in your project repo | `.dev-agents/` with the spec / test-design / implement / review workflows pi should run |
| **An LLM provider** reachable by pi | local (Ollama, LM Studio, …) or any OpenAI-compatible endpoint |

> Air-gapped? `provider: "local"` + a local model works fully offline — synod-lite makes no network calls itself; only pi talks to the model.

## Install

```bash
git clone https://github.com/Mikenahh92/synod-lite.git
cd synod-lite
npm install            # runtime deps only (ink); no build step
npm link               # optional: puts `synod-lite` on PATH
```

Without `npm link`, invoke it directly: `node /path/to/synod-lite/bin/synod-lite.js <command>`.

Verify the install:

```bash
npm test               # 20/20 should pass (uses fake agents, no LLM needed)
synod-lite --help      # command overview
```

## Configure your project

Run synod-lite *from inside* a git repo that has your dev-agents workflows. Copy the example config and edit it:

```bash
cd /path/to/your-project
cp /path/to/synod-lite/.synod-lite.example.json .synod-lite.json
```

`.synod-lite.json` — every field optional, these are the defaults:

```json
{
  "piBin": "pi",
  "provider": "local",
  "model": "",
  "workers": 2,
  "maxRetries": 3,
  "auto": "spec",
  "trunk": "main",
  "worktreeRoot": ".synod-lite/worktrees",
  "daemonPort": 8799,
  "timeoutMs": 1800000
}
```

- `piBin` — path or command that runs pi (use an absolute path if pi is not on PATH)
- `provider` / `model` — passed through to pi; must match your pi provider config
- `workers` — parallel agent stories; keep low on a single shared LLM endpoint
- `auto` — `"spec"` (default): human gates at spec approval **and** merge · `"full"`: also auto-merges after a PASS review
- `trunk` — branch that stories squash-merge into
- `.synod-lite/` (worktrees + state) is created automatically and should stay git-ignored

## First run

```bash
synod-lite start                 # background daemon (advances stories)
synod-lite ui                    # TUI dashboard — starts the daemon if needed
```

Then in the TUI: `n` creates a story, the spec agent starts automatically, `a` approves it into development, `m` merges after PASS. `c` opens the chat agent, `?`-bar confirmations gate destructive keys (`R` reset, `K` kill).

Full command reference: [README.md](README.md).

## Troubleshooting

- **`no git repo found upward from …`** — run from inside your project repo.
- **Stories never advance** — is the daemon up? `synod-lite list` shows a "waiting" state; `synod-lite start` boots it. Check `workers` > 0.
- **A story is stuck in `refining`/`in_development`** — `synod-lite log <id>` tails the live agent log; `synod-lite retry <id>` requeues.
- **No colours / odd layout** — set `TERM=xterm-256color`; the UI reads live terminal size and re-renders on resize.
- **Port conflict** — two projects on one machine: give each a different `daemonPort`.

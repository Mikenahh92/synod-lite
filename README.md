# pitboss

Story harness for [pi](https://github.com/earendil-works/pi) + [dev-agents](https://github.com/Mikenahh92/dev-agents): one story = one git worktree, an agent pipeline that drafts specs, develops, and reviews — with humans only at the gates that matter.

```
new ──▶ spec ──▶ [approve] ──▶ develop ──▶ review ──▶ done ──▶ [merge]
                      ▲                        │ FAIL          │
                      └──── auto retry ◀────────┘ (max 3)      ▼
                                                          needs_human
```

## What it does

- **Stories are worktrees** — every story gets its own branch + worktree, so multiple agents can work in parallel without touching each other (or your checkout).
- **Gated pipeline** — spec → test-design → implement → review, all run headlessly by pi + dev-agents. You approve specs, you merge. Everything in between is automatic.
- **Self-healing reviews** — a FAIL review feeds itself back into implement with the failure report, up to `maxRetries`. Exhausted retries park the story at `needs_human` with the full trail.
- **Daemon + CLI + TUI** — a background daemon drives up to `workers` stories concurrently; the CLI and a full-screen TUI dashboard both talk to it.

## Install

Requires Node ≥ 22 (24 recommended). In a repo that already has dev-agents installed (`.dev-agents/`, `.pi/`):

```bash
cp .pitboss.example.json .pitboss.json   # from this repo, then edit
# make `pitboss` available (or run via path):
~/path/to/pitboss/bin/pitboss.js start
~/path/to/pitboss/bin/pitboss.js ui
```

## Configuration (`.pitboss.json` in the target repo root)

```json
{
  "piBin": "pi",
  "provider": "local",
  "model": "your-model-id",
  "workers": 2,
  "maxRetries": 3,
  "auto": "spec",
  "trunk": "main",
  "timeoutMs": 1800000,
  "daemonPort": 8799
}
```

- `piBin`: absolute path to the pi binary (matters when pi is not on PATH, e.g. `~/applications/pi/pi`)
- `provider`/`model`: as configured in `~/.pi/agent/models.json`
- `auto`: `spec` (default) stops at spec approval + merge; `full` also auto-merges after review PASS
- `workers`: max stories developing concurrently — keep it low on a single shared LLM endpoint

## Usage

```
pitboss new "<title>"   create story + worktree; spec starts automatically
pitboss start           background daemon (workers advance stories)
pitboss ui              TUI dashboard (starts daemon if needed)
pitboss list            overview
pitboss approve <id>    approve spec → development starts
pitboss merge <id>      squash-merge finished story into trunk
pitboss retry <id>      reset a failed/needs_human story
pitboss kill <id>       drop a story and remove its worktree
pitboss log <id>        tail latest phase log
pitboss step <id>       single advance without daemon (blocking)
```

TUI keys: `j/k` select · `a` approve · `r` retry · `m` merge · `K` kill · `l` log · `q` quit.

State lives in `.pitboss/state.json` (git-ignored); phase logs in `.pitboss/logs/<story>/`.

## Story states

`created → speccing → spec_ready → (approve) → developing → reviewing → done → (merge) → merged`
With failure paths: `failed` (phase error), `needs_human` (review FAIL after maxRetries), `killed`.

## Design notes

- The **harness** owns state transitions; pi/dev-agents are dumb executors of one workflow each. Agents never advance their own story.
- Review verdicts are parsed from the dev-agents review report's gate decision (PASS/FAIL).
- Proxies: pi is spawned with `http_proxy`/`https_proxy` etc. stripped — corporate web gateways must not intercept internal LLM endpoints.
- Merge requires a clean main worktree; squash-commit lands as `S-00N: <title>`.

## Tests

`npm test` — full e2e suite with a fake-pi shim: pipeline, feedback retry loop, and daemon autonomy.

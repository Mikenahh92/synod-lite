# dev-agents

Spec-driven agent library for this repository (codex + pi). Installed under `.dev-agents/`.

## Commands (`/command`)

Native slash commands are installed for pi (`.pi/prompts/`) and codex (`.codex/prompts/`):

- `/spec`, `/test-design`, `/feature`, `/implement`, `/review`, `/research`, `/init` — run the matching workflow in `.dev-agents/workflows/`.
- Runs headless by default (no approval gates). Append `#ask` to force interactive approval gates: `/implement #ask`.
- A workflow activates the agent named in its `workflow.yaml` (planner / developer / tester).

You can also invoke workflows conversationally without slash commands (e.g. "run the spec workflow").

## Layout

- `.dev-agents/config.yaml` — user name, language, output/specs folders
- `.dev-agents/agents/` — planner, developer, tester
- `.dev-agents/core/tasks/` — workflow engine: `workflow.xml` (headless default) + `workflow-gated.xml` (interactive, `#ask`)
- `.dev-agents/workflows/` — 6 workflows (see `.dev-agents/workflows/*/workflow.yaml`)
- `.dev-agents/specs/` — specs, test designs, research; `specs/features/` holds multi-spec feature dossiers (git-track if you want specs in history)
- `.dev-agents/docs/` — durable project docs authored by `/init`: `prd.md`, `core-architecture.md`, `style-guide.md` (git-track these; every workflow loads them as grounding)
- `.dev-agents/output/` — state: implementation reports, review verdicts (git-ignored)
- `.pi/prompts/` — pi slash commands (load after project trust; `/reload` picks up changes)
- `.codex/prompts/` — codex custom prompts

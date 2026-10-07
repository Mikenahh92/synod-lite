# dev-agents

<purpose>Spec-driven agent library for this repository (codex + pi). Installed under `.dev-agents/`.</purpose>

<commands>
  <slash prefix="/">/spec, /test-design, /feature, /implement, /review, /research, /init — run the matching workflow in `.dev-agents/workflows/`.</slash>
  <native>Slash commands are installed for pi (`.pi/prompts/`) and codex (`.codex/prompts/`).</native>
  <gating default="headless">Runs headless by default (no approval gates). Append #ask to force interactive approval gates: /implement #ask.</gating>
  <agents>A workflow activates the agent named in its `workflow.yaml` (planner / developer / tester).</agents>
  <conversational>You can also invoke workflows conversationally without slash commands (e.g. "run the spec workflow").</conversational>
</commands>

<layout>
  <path role="config">.dev-agents/config.yaml — user name, language, output/specs folders</path>
  <path role="agents">.dev-agents/agents/ — planner, developer, tester</path>
  <path role="engine">.dev-agents/core/tasks/ — workflow engine: workflow.xml (headless default) + workflow-gated.xml (interactive, #ask)</path>
  <path role="workflows">.dev-agents/workflows/ — 6 workflows (see .dev-agents/workflows/*/workflow.yaml)</path>
  <path role="specs" git_track="optional">.dev-agents/specs/ — specs, test designs, research; specs/features/ holds multi-spec feature dossiers</path>
  <path role="docs" git_track="yes">.dev-agents/docs/ — durable project docs authored by /init: prd.md, core-architecture.md, style-guide.md; every workflow loads them as grounding</path>
  <path role="output" git_ignore="yes">.dev-agents/output/ — state: implementation reports, review verdicts</path>
  <path role="pi_prompts">.pi/prompts/ — pi slash commands (load after project trust; /reload picks up changes)</path>
  <path role="codex_prompts">.codex/prompts/ — codex custom prompts</path>
</layout>

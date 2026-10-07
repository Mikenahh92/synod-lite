---
description: "dev-agents: plan a multi-spec feature (dossier: UX + architecture + slice breakdown)"
argument-hint: "<feature description> [#ask]"
---
<task>Run the dev-agents `feature` workflow now.</task>

<load_context order="strict">
  <step n="1">Read `.dev-agents/config.yaml` and apply it.</step>
  <step n="2">Read `.dev-agents/workflows/feature/workflow.yaml` and activate the agent it names (from `.dev-agents/agents/`) — follow that agent's rules for the whole task.</step>
  <step n="3">Execute the workflow (`workflow.yaml` + `instructions.md`) through the engine in `.dev-agents/core/tasks/workflow.xml`.</step>
</load_context>

<arguments>$ARGUMENTS</arguments>

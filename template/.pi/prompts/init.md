---
description: "dev-agents: run the init workflow"
argument-hint: "[args] [#ask]"
---
<task>Run the dev-agents `init` workflow now.</task>

<load_context order="strict">
  <step n="1">Read `.dev-agents/config.yaml` and apply it.</step>
  <step n="2">Read `.dev-agents/workflows/init/workflow.yaml` and activate the agent it names (from `.dev-agents/agents/`) — follow that agent's rules for the whole task.</step>
  <step n="3">Execute the workflow (`workflow.yaml` + `instructions.md`) through the engine in `.dev-agents/core/tasks/workflow.xml`.</step>
</load_context>

<arguments>$ARGUMENTS</arguments>

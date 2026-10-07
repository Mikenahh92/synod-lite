---
description: "dev-agents: run the init workflow"
argument-hint: "[args] [#ask]"
---
Run the dev-agents `init` workflow now.

Before anything else, load context exactly as the engine requires:
1. Read `.dev-agents/config.yaml` and apply it.
2. Read `.dev-agents/workflows/init/workflow.yaml` and activate the agent it names (from `.dev-agents/agents/`) — follow that agent's rules for the whole task.
3. Execute the workflow (`workflow.yaml` + `instructions.md`) through the engine in `.dev-agents/core/tasks/workflow.xml`.

Arguments: $ARGUMENTS

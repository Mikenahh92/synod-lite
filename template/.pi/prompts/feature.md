---
description: "dev-agents: plan a multi-spec feature (dossier: UX + architecture + slice breakdown)"
argument-hint: "<feature description> [#ask]"
---
Run the dev-agents `feature` workflow now.

Before anything else, load context exactly as the engine requires:
1. Read `.dev-agents/config.yaml` and apply it.
2. Read `.dev-agents/workflows/feature/workflow.yaml` and activate the agent it names (from `.dev-agents/agents/`) — follow that agent's rules for the whole task.
3. Execute the workflow (`workflow.yaml` + `instructions.md`) through the engine in `.dev-agents/core/tasks/workflow.xml`.

Arguments: $ARGUMENTS

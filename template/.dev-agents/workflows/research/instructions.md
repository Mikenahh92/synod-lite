# Research Workflow

Engine: `.dev-agents/core/tasks/workflow.xml` (headless default; `#ask` switches to workflow-gated.xml). Every claim must cite file paths + line evidence. No speculation without a label.

1. **Frame** — restate the question; list what to look for.
2. **Investigate** — search the codebase (structure, key modules, data flow, tests). For new features: existing patterns to reuse, integration points, risks.
3. **Write findings** — `{specs_folder}/research/research-{date}.md`: summary, evidence (path-cited), options/recommendations, open questions.
   `template-output → save, show, approve`

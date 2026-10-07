# Research Workflow

<engine path=".dev-agents/core/tasks/workflow.xml" mode="headless">#ask switches to workflow-gated.xml.</engine>
<contract>Every claim must cite file paths + line evidence. No speculation without a label.</contract>

<steps>
  <step n="1" name="Frame">Restate the question; list what to look for.</step>
  <step n="2" name="Investigate">Search the codebase (structure, key modules, data flow, tests). For new features: existing patterns to reuse, integration points, risks.</step>
  <step n="3" name="Write findings">{specs_folder}/research/research-{date}.md: summary, evidence (path-cited), options/recommendations, open questions.
    <output>template-output → save, show, approve</output>
  </step>
</steps>

# Feature Workflow (multi-spec feature dossier)

<engine path=".dev-agents/core/tasks/workflow.xml" mode="headless">#ask switches to workflow-gated.xml.</engine>
<when>Use for features too large for one spec. If the work fits a single spec, say so and suggest /spec instead — do not pad.</when>
<mode name="conversational">Interview the user in small rounds (2–4 questions, offer best-guess options) about what the repo and existing docs cannot answer. Never invent. Mark unknowns **Unknown — needs decision**.</mode>

<steps>
  <step n="1" name="Ground">Read {docs_folder}/prd.md, core-architecture.md, style-guide.md, and relevant existing code. If the feature conflicts with the PRD or architecture, say so before proceeding.</step>
  <step n="2" name="Frame">Problem, target users, core value, explicit non-goals. Pull the answer from the user when unclear.</step>
  <step n="3" name="UX design" user_facing_only="true">User flows, screens/views described concretely (text wireframes or mermaid when helpful), edge cases and error states. For backend features write one line: "Not user-facing — no UX section."</step>
  <step n="4" name="Architecture impact">Components touched and how, data model changes, migrations, new dependencies (and why), performance/security considerations, risks.</step>
  <step n="5" name="Spec breakdown">Decompose into slices that are each implementable and reviewable as ONE spec. Each slice: title, one-paragraph scope, dependencies on other slices, suggested order. Record as a status table:

    | # | Slice | Depends on | Status |
    |---|-------|------------|--------|
    | 1 | … | — | proposed |

    <statuses>proposed → spec'd → implemented → reviewed</statuses>
  </step>
  <step n="6" name="Save">{specs_folder}/features/{slug}.md (choose a short slug). Show the user the slice list and the suggested next step: /spec on slice 1.
    <output>template-output → save, show, approve</output>
  </step>
</steps>

<validation_gate>
  <check>every slice is small enough for one spec</check>
  <check>dependencies form no cycles</check>
  <check>UX covers all user-facing slices</check>
  <check>architecture names every touched component</check>
</validation_gate>

<slice_status_maintenance>
  When /spec completes a slice from a feature dossier, mark that slice spec'd; /implement → implemented; /review pass → reviewed. Update the dossier's status table in the same run. The dossier is the feature's system of record.
</slice_status_maintenance>

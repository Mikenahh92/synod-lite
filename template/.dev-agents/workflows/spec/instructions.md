# Spec Workflow

<engine path=".dev-agents/core/tasks/workflow.xml" mode="headless">#ask switches to workflow-gated.xml.</engine>
<contract>One spec per feature: {specs_folder}/{feature}.md. The spec is the system of record — detail is mandatory, not optional.</contract>

<steps>
  <step n="0" name="Ground">
    Read {docs_folder}/prd.md and {docs_folder}/style-guide.md if present. The spec must stay consistent with them; if the request conflicts with the PRD, say so before proceeding.
    If the request names (or matches) a feature dossier in {specs_folder}/features/, this spec covers ONE slice of it: name the slice, stay consistent with the dossier's UX/architecture decisions, and after the validation gate mark that slice spec'd in the dossier's status table.
  </step>
  <step n="1" name="Frame">Problem statement, target users, core value. Five sentences max.
    <output>template-output → save to {feature}.md, show, approve</output>
  </step>
  <step n="2" name="Goals &amp; non-goals">In scope now; explicitly out of scope.
    <output>template-output → save, show, approve</output>
  </step>
  <step n="3" name="Requirements">Numbered (R1, R2, …). Each requirement is atomic and implementable; no compound requirements.
    <output>template-output → save, show, approve</output>
  </step>
  <step n="4" name="Acceptance criteria">Numbered (AC1, AC2, …), each mapped to ≥1 requirement. Every AC must be objectively verifiable by a test, a command, or an inspection. Vague terms ("works correctly", "user-friendly", "fast", "robust") are FORBIDDEN unless quantified with a measurable threshold.
    <output>template-output → save, show, approve</output>
  </step>
  <step n="5" name="Test expectations">Per AC: how it will be verified (test type, command, fixture, or manual inspection procedure).
    <output>template-output → save, show, approve</output>
  </step>
  <step n="6" name="Constraints, risks, open questions">Technical and business constraints, known risks. Unknowns go under Open Questions — NEVER resolved by silent assumption.
    <output>template-output → save, show, approve</output>
  </step>
</steps>

<validation_gate mandatory="true" note="spec is invalid without it">
  <check>every requirement has ≥1 AC</check>
  <check>every AC is objectively verifiable (state how)</check>
  <check>no unquantified vague language anywhere</check>
  <check>every open question is listed, not assumed away</check>
  <on_fail>If any check fails: fix the spec and re-run this gate. Do NOT present the spec as done while the gate fails — report exactly which checks failed.</on_fail>
  <output>template-output → append validation result to the spec, show, approve</output>
</validation_gate>

<diagrams policy="ascii_only" reason="spec/test-design documents are read in a terminal UI">
  When a diagram, graph, or structure would clarify the document, render it as ASCII art (box-drawing characters, monospace-safe). No mermaid, no images, no HTML.
</diagrams>

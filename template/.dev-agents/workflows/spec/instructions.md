# Spec Workflow

<engine path=".dev-agents/core/tasks/workflow.xml" mode="headless">#ask switches to workflow-gated.xml.</engine>
<role>You are the spec author. The spec you write is the system of record: implement, test-design and review all act on your words and nothing else. Ambiguity you leave in becomes a defect someone else ships.</role>
<contract>One spec per feature: {specs_folder}/{feature}.md. Detail is mandatory, not optional.</contract>

<steps>
  <step n="0" name="Ground">
    Read {docs_folder}/prd.md and {docs_folder}/style-guide.md if present. The spec must stay consistent with them; if the request conflicts with the PRD, say so before proceeding.
    If the request names (or matches) a feature dossier in {specs_folder}/features/, this spec covers ONE slice of it: name the slice, stay consistent with the dossier's UX/architecture decisions, and after the validation gate mark that slice spec'd in the dossier's status table.
  </step>

  <step n="1" name="Frame">
    Problem statement, target users, core value. Five sentences max. If you cannot state the problem without describing the solution, you do not understand it yet — ask.
    <output>template-output → save to {feature}.md, show, approve</output>
  </step>

  <step n="2" name="Goals &amp; non-goals">
    In scope now; explicitly out of scope. Non-goals are load-bearing: implementers must be able to point at a line when asked to creep scope. Name each non-goal as a full sentence with its reason ("X is out of scope because Y").
    <output>template-output → save, show, approve</output>
  </step>

  <step n="3" name="Requirements">
    Numbered (R1, R2, …). Each requirement:
    <rules>
      <rule>Atomic — one verifiable statement; if "and"/"or" joins two behaviours, split it.</rule>
      <rule>Implementable — names the WHAT (behaviour, interface, constraint), not the HOW (no tech choices unless they ARE the requirement).</rule>
      <rule>Singular subject — "The system shall…", "The API shall…" — one actor per requirement.</rule>
      <rule>Traceable — written so an AC can reference it unambiguously.</rule>
    </rules>
    <output>template-output → save, show, approve</output>
  </step>

  <step n="4" name="Acceptance criteria">
    Numbered (AC1, AC2, …), each mapped to ≥1 requirement. An AC is objectively verifiable when a third party can run ONE test, command, or inspection and agree on the outcome. Concretely:
    <rules>
      <rule>Structure: given {precondition}, when {action}, then {observable outcome}.</rule>
      <rule>Quantify everything: "responds within 500ms p95", "accepts up to 10k rows", "rejects non-numeric input with error E422" — never "fast", "large", "robust".</rule>
      <rule>Vague terms ("works correctly", "user-friendly", "fast", "robust", "properly") are FORBIDDEN unless followed by a measurable threshold.</rule>
      <rule>Each AC states HOW it is checked: a test, a command with expected output, or a named inspection procedure.</rule>
      <rule>Include negative criteria for input-accepting features: what is rejected, and what the user sees when it is.</rule>
    </rules>
    <output>template-output → save, show, approve</output>
  </step>

  <step n="5" name="Test expectations">
    Per AC: how it will be verified — test type (unit/integration/e2e/manual), the command or fixture, and the expected observable result. This section seeds the test-design workflow; write it as instructions to a test designer who has not read your mind:
    <matrix format="table">| AC | Type | How to verify (command/fixture/procedure) | Expected observable result |</matrix>
    <output>template-output → save, show, approve</output>
  </step>

  <step n="6" name="Constraints, risks, open questions">
    Technical and business constraints (hard limits, compliance, environment); known risks with severity and what would trigger them.
    <open_questions rule="explicit">Unknowns go under Open Questions, each numbered (Q1, Q2…), each stating WHO can answer it. NEVER resolve an open question by silent assumption — an assumed answer becomes a defect at review time.</open_questions>
    <output>template-output → save, show, approve</output>
  </step>
</steps>

<validation_gate mandatory="true" note="spec is invalid without it">
  <check>every requirement has ≥1 AC</check>
  <check>every AC is objectively verifiable (state how — one test, command, or inspection per AC)</check>
  <check>no unquantified vague language anywhere</check>
  <check>every open question is listed and numbered, not assumed away</check>
  <check>every input-accepting requirement has a negative criterion (rejection behaviour specified)</check>
  <on_fail>If any check fails: fix the spec and re-run this gate. Do NOT present the spec as done while the gate fails — report exactly which checks failed.</on_fail>
  <output>template-output → append validation result to the spec, show, approve</output>
</validation_gate>

<diagrams policy="ascii_only" reason="spec/test-design documents are read in a terminal UI">
  When a diagram, graph, or structure would clarify the document, render it as ASCII art (box-drawing characters, monospace-safe). No mermaid, no images, no HTML.
</diagrams>

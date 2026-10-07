# Test Design Workflow

<engine path=".dev-agents/core/tasks/workflow.xml" mode="headless">#ask switches to workflow-gated.xml.</engine>
<role>You are the test designer. You produce a risk-driven test plan that a developer or tester can execute mechanically. You write design and analysis only — never application code, never spec edits.</role>
<inputs>Spec path (default: newest spec in {specs_folder}).</inputs>

<steps>
  <step n="1" name="Load spec">
    Read the COMPLETE spec, not a summary. Then extract, verbatim into your working notes:
    <extract>
      <item>every acceptance criterion with its id (AC1, AC2, …) and the requirement(s) it maps to</item>
      <item>every stated risk and constraint (including performance/security numbers)</item>
      <item>every test expectation the spec already records (step 5 of the spec workflow) — these are mandatory inputs, refine them, do not drop them</item>
      <item>all vague or unquantified wording — these become risks, and must be reported back</item>
    </extract>
    <halt_on>If the spec has no acceptance criteria or no passing validation gate: halt and tell the user to run *spec first. Never design tests against an unvalidated spec.</halt_on>
  </step>

  <step n="2" name="Risk analysis" output="risk_table">
    For EACH acceptance criterion, enumerate what breaks it in practice. Systematically walk this taxonomy — do not rely on whatever comes to mind first:
    <risk_taxonomy>
      <category name="boundary">empty / one / many; min/max values; off-by-one; unicode &amp; special characters; very long input; timezone &amp; locale.</category>
      <category name="error_paths">invalid input; missing data; downstream failure (network, disk, third-party); partial failure mid-operation; malformed fixture.</category>
      <category name="state">first run vs rerun; idempotency; concurrent invocation; state left behind by a previous failure; migration/upgrade from old state.</category>
      <category name="integration">interface contract drift; ordering assumptions; auth/permission boundaries; data format at the boundary.</category>
      <category name="regression">existing behaviour the diff could plausibly break — name the files/modules.</category>
      <category name="non_functional" only_if_quantified_in_spec>performance thresholds, capacity limits, security requirements. If the spec quantifies it, test it; if not, it is NOT a test case — flag it as a spec gap.</category>
    </risk_taxonomy>
    Score each risk: <probability>high | medium | low</probability> × <impact>high | medium | low</impact>. Rank the table by (impact, probability).
    <rule>Every risk must trace to an AC id. A risk that traces to nothing is a signal the spec is missing a criterion — report it in the open-questions section instead of inventing coverage.</rule>
  </step>

  <step n="3" name="Test plan" output="test_cases">
    One or more test cases per AC. Prefer the happy path first, then the highest-ranked risks, then the tail. Each test case uses this schema, as a table row or definition list — every field required, "—" only when truly N/A:
    <test_case_schema>
      <field name="id">TD-01, TD-02, … unique, stable (implement and review reports cite these ids).</field>
      <field name="ac">the AC id(s) this case verifies.</field>
      <field name="risk">the risk id from step 2 this case kills, or "nominal".</field>
      <field name="type">unit | integration | e2e | manual — pick the cheapest layer that still observes the behaviour through the real interface.</field>
      <field name="setup">state, fixtures, seed data, config — concrete enough to recreate without asking questions.</field>
      <field name="action">the exact operation under test (command, API call, user gesture).</field>
      <field name="expected">the observable, verifiable outcome — a value to compare, a status code, an inspection procedure. "Works" is not an expectation.</field>
      <field name="verify">the command to run (exact), the fixture to create, or the manual procedure with the evidence to capture (screenshot, log line).</field>
    </test_case_schema>
    <rules>
      <rule name="cheapest_layer">Push tests as low in the stack as the AC allows: unit first, integration when a boundary is involved, e2e only for user-visible flows, manual only when automation is impossible — and then with a capture step.</rule>
      <rule name="one_assertion_cluster">One case tests one behaviour. A case needing more than a handful of assertions is several cases.</rule>
      <rule name="negative_tests">Every input-accepting AC gets at least one negative/boundary case, not only the happy path.</rule>
      <rule name="no_implementation">Design against the spec's interface, not against code you imagine. File paths from the actual repo may inform setup; the expected outcomes come from the AC.</rule>
    </rules>
  </step>

  <step n="4" name="Coverage matrix" output="matrix">
    A two-column trace table: every AC → the TD ids that cover it, plus a reverse row for high-impact risks without coverage. This matrix is what the review workflow later uses to decide PASS/FAIL per AC — build it as if review correctness depends on it, because it does.
  </step>
</steps>

<validation_gate>
  <check>every AC has ≥1 test case</check>
  <check>every test case traces to an AC id or an explicit, numbered risk</check>
  <check>every input-accepting AC has ≥1 negative or boundary case</check>
  <check>every manual case names its evidence-capture step</check>
  <check>every expected outcome is objectively verifiable (value, status, procedure) — no unquantified adjectives</check>
  <check>coverage matrix exists and is consistent with the test case list</check>
  <on_fail>Report the gaps explicitly and fix the design before saving. Do not present a plan whose gate fails.</on_fail>
  <output>template-output → save to {specs_folder}/test-design-{feature}.md, show, approve</output>
</validation_gate>

<document_structure>
  Save in this order: 1) Header (feature, spec path/date, status). 2) Risk table. 3) Test cases (schema fields per case). 4) Coverage matrix. 5) Open questions (spec gaps found while designing — vague ACs, unquantified claims, uncovered risks).
</document_structure>

<diagrams policy="ascii_only" reason="spec/test-design documents are read in a terminal UI">
  When a diagram, graph, or structure would clarify the document, render it as ASCII art (box-drawing characters, monospace-safe). No mermaid, no images, no HTML.
</diagrams>

# Implement Workflow

<engine path=".dev-agents/core/tasks/workflow.xml" mode="headless">#ask switches to workflow-gated.xml.</engine>
<inputs>Spec path (default: newest *.md in {specs_folder}).</inputs>

<steps>
  <step n="1" name="Load spec">Read the COMPLETE spec. If it lacks acceptance criteria or a passing validation gate, halt and tell the user to run *spec first. Never implement against a vague spec.</step>
  <step n="2" name="Gather context">Locate the relevant modules and tests from the spec plus {docs_folder}/core-architecture.md and {docs_folder}/style-guide.md if present. Read them before changing code. Grounding beats priors.</step>
  <step n="3" name="Plan">Map each requirement to concrete file changes; prefer reusing existing interfaces and patterns.</step>
  <step n="4" name="Implement">Work in requirement order, tests included. Check off requirements in the spec as they complete. Halt only for blockers; report them precisely (file, line, reason).
    <rule name="test_design_conflicts">If a test-design expectation looks incorrect or contradicts the spec, do NOT special-case the code to satisfy it — implement to the spec and flag the expectation in your report (test id + reason). With #ask, stop and ask instead.</rule>
  </step>
  <step n="5" name="Verify + report">Run the relevant test suite (record the exact commands you ran and their real outcomes — never claim a command ran that you did not run). Report per AC: met / not met, how verified, files touched, deviations from the spec and why. Any date, git state, or environment fact in the report must come from a command you ran this session; otherwise write "not verified".
    <output>template-output → implementation report to {output_folder}/implement-{feature}.md, show, approve</output>
  </step>
</steps>

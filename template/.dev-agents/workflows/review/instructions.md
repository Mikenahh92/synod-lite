# Review Workflow

<engine path=".dev-agents/core/tasks/workflow.xml" mode="headless">#ask switches to workflow-gated.xml.</engine>
<inputs>Spec path + diff/PR scope (defaults: newest spec in {specs_folder}, uncommitted changes).</inputs>

<steps>
  <step n="1" name="Load spec + diff">Read the COMPLETE spec and the full diff under review. If there is no spec, say so and review as a plain code review (no AC trace possible).</step>
  <step n="2" name="Build &amp; test">Run the build and relevant test suites; record the exact commands and their real outcomes.</step>
  <step n="3" name="AC coverage trace">For each acceptance criterion in the spec: which test or inspection verifies it, and does the diff satisfy it? Flag any gap. Standard code-review checks in addition: correctness, security, error handling, dead code, spec deviations.</step>
  <step n="4" name="Gate decision">PASS or FAIL with reasons per failing AC. Record the verdict exactly ONCE, in your own report: {output_folder}/review-{feature}.md. Never append to or edit the implementation report or any other workflow's output.
    <output>template-output → review verdict, show, approve</output>
  </step>
</steps>

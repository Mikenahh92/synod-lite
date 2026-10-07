# Review Workflow

Engine: `.dev-agents/core/tasks/workflow.xml` (headless default; `#ask` switches to workflow-gated.xml). Inputs: spec path + diff/PR scope (defaults: newest spec in `{specs_folder}`, uncommitted changes).

1. **Load spec + diff** — read the COMPLETE spec and the full diff under review. If there is no spec, say so and review as a plain code review (no AC trace possible).
2. **Build & test** — run the build and relevant test suites; record the exact commands and their real outcomes.
3. **AC coverage trace** — for each acceptance criterion in the spec: which test or inspection verifies it, and does the diff satisfy it? Flag any gap. Standard code-review checks in addition: correctness, security, error handling, dead code, spec deviations.
4. **Gate decision** — PASS or FAIL with reasons per failing AC. Record the verdict exactly ONCE, in your own report: `{output_folder}/review-<feature>.md`. Never append to or edit the implementation report or any other workflow's output.
   `template-output → review verdict, show, approve`

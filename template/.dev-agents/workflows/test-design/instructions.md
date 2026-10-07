# Test Design Workflow

Engine: `.dev-agents/core/tasks/workflow.xml` (headless default; `#ask` switches to workflow-gated.xml). Input: spec path (default: newest spec in `{specs_folder}`).

1. **Load spec** — read the COMPLETE spec; list every acceptance criterion and stated risk/constraint.
2. **Risk analysis** — for each AC: what breaks it in practice (edge cases, failure modes, integration points)? Rank risks.
3. **Test plan** — for each AC, one or more test cases: id, AC reference, type (unit/integration/manual), setup, action, expected verifiable outcome, command or fixture. Every AC must be covered by ≥1 test case; every test case must trace to an AC or an explicit risk.
4. **Validation gate** — no AC without a test case; no test case without a traceable AC/risk. Report gaps explicitly.
   `template-output → save to {specs_folder}/test-design-<feature>.md, show, approve`

## Diagrams

When a diagram, graph, or structure would clarify the document, render it as **ASCII art** (box-drawing characters, monospace-safe). The spec/test-design documents are read in a terminal UI — no mermaid, no images, no HTML.

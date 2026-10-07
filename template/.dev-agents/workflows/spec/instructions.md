# Spec Workflow

Engine: `.dev-agents/core/tasks/workflow.xml` (headless default; `#ask` switches to workflow-gated.xml). One spec per feature: `{specs_folder}/<feature>.md`. The spec is the system of record — detail is mandatory, not optional.

0. **Ground** — read `{docs_folder}/prd.md` and `{docs_folder}/style-guide.md` if present. The spec must stay consistent with them; if the request conflicts with the PRD, say so before proceeding.
   If the request names (or matches) a feature dossier in `{specs_folder}/features/`, this spec covers ONE slice of it: name the slice, stay consistent with the dossier's UX/architecture decisions, and after the validation gate mark that slice `spec'd` in the dossier's status table.
1. **Frame** — problem statement, target users, core value. Five sentences max.
   `template-output → save to <feature>.md, show, approve`
2. **Goals & non-goals** — in scope now; explicitly out of scope.
   `template-output → save, show, approve`
3. **Requirements** — numbered (R1, R2, …). Each requirement is atomic and implementable; no compound requirements.
   `template-output → save, show, approve`
4. **Acceptance criteria** — numbered (AC1, AC2, …), each mapped to ≥1 requirement. Every AC must be objectively verifiable by a test, a command, or an inspection. Vague terms ("works correctly", "user-friendly", "fast", "robust") are FORBIDDEN unless quantified with a measurable threshold.
   `template-output → save, show, approve`
5. **Test expectations** — per AC: how it will be verified (test type, command, fixture, or manual inspection procedure).
   `template-output → save, show, approve`
6. **Constraints, risks, open questions** — technical and business constraints, known risks. Unknowns go under Open Questions — NEVER resolved by silent assumption.
   `template-output → save, show, approve`
7. **Validation gate (MANDATORY — spec is invalid without it)** — check all of:
   - every requirement has ≥1 AC
   - every AC is objectively verifiable (state how)
   - no unquantified vague language anywhere
   - every open question is listed, not assumed away
   If any check fails: fix the spec and re-run this gate. Do NOT present the spec as done while the gate fails — report exactly which checks failed.
   `template-output → append validation result to the spec, show, approve`

## Diagrams

When a diagram, graph, or structure would clarify the document, render it as **ASCII art** (box-drawing characters, monospace-safe). The spec/test-design documents are read in a terminal UI — no mermaid, no images, no HTML.

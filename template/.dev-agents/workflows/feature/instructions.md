# Feature Workflow (multi-spec feature dossier)

Engine: `.dev-agents/core/tasks/workflow.xml` (headless default; `#ask` switches to workflow-gated.xml). Use this for features too large for one spec. If the work fits a single spec, say so and suggest `/spec` instead — do not pad.

**Mode: conversational.** Interview the user in small rounds (2–4 questions, offer best-guess options) about what the repo and existing docs cannot answer. **Never invent.** Mark unknowns `**Unknown — needs decision**`.

1. **Ground** — read `{docs_folder}/prd.md`, `core-architecture.md`, `style-guide.md`, and relevant existing code. If the feature conflicts with the PRD or architecture, say so before proceeding.
2. **Frame** — problem, target users, core value, explicit non-goals. Pull the answer from the user when unclear.
3. **UX design** (only if user-facing) — user flows, screens/views described concretely (text wireframes or mermaid when helpful), edge cases and error states. For backend features write one line: "Not user-facing — no UX section."
4. **Architecture impact** — components touched and how, data model changes, migrations, new dependencies (and why), performance/security considerations, risks.
5. **Spec breakdown** — decompose into slices that are each implementable and reviewable as ONE spec. Each slice: title, one-paragraph scope, dependencies on other slices, suggested order. Record as a status table:

   | # | Slice | Depends on | Status |
   |---|-------|------------|--------|
   | 1 | … | — | proposed |

   Valid statuses: `proposed → spec'd → implemented → reviewed`.
6. **Validation gate** — every slice is small enough for one spec; dependencies form no cycles; UX covers all user-facing slices; architecture names every touched component.
7. **Save** — `{specs_folder}/features/<slug>.md` (choose a short slug). Show the user the slice list and the suggested next step: `/spec` on slice 1.
   `template-output → save, show, approve`

## Slice status maintenance
When `/spec` completes a slice from a feature dossier, mark that slice `spec'd`; `/implement` → `implemented`; `/review` pass → `reviewed`. Update the dossier's status table in the same run. The dossier is the feature's system of record.

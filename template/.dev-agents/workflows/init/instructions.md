# Init Project Workflow (conversational docs bootstrap)

Engine: `.dev-agents/core/tasks/workflow.xml` (headless default; `#ask` switches to workflow-gated.xml). You are bootstrapping this repository's durable documentation. These docs are the system of record: every later workflow (spec, implement, review) loads them before acting. Quality here compounds.

**Mode: conversational.** You are interviewing the user, not interrogating the repo alone. Work in small rounds: survey what you can determine yourself first, then ask only about what the repo cannot tell you. 2–4 questions per round, plain language, offer your best guess as a multiple-choice option when you have one. Never dump 15 questions at once.

**Never invent.** Anything you could not verify from the repo and the user's answers gets marked `**Unknown — needs decision**`, not plausible-sounding filler.

1. **Survey** — README, manifests, CI config, entry points, test setup, directory layout. Form your own picture before asking anything.
2. **Interview round(s)** — ask the user about what code cannot answer: who uses this, what problem it solves, what success looks like, what is deliberately out of scope, architectural decisions and *why* they were made, non-negotiable conventions. In default headless mode skip interviewing: derive everything from the repo and mark the rest as unknowns.
3. **PRD** — `{docs_folder}/prd.md`: purpose, target users, core value, current scope, explicit non-goals, known limitations.
   `template-output → save, show, approve`
4. **Core architecture** — `{docs_folder}/core-architecture.md`: components and responsibilities, data flow, tech stack *with versions*, build/run/test instructions, key dependencies and why they exist.
   `template-output → save, show, approve`
5. **Style guide** — `{docs_folder}/style-guide.md`: observed conventions — naming, file structure, patterns, error handling, testing style, commit message style if discernible. Describe what the repo *does*, plus user-stated rules; separate the two (`Observed:` vs `Mandated:`).
   `template-output → save, show, approve`
6. **Recap** — one short summary: what was written, which questions remain open, and the suggested next step (`/spec` on the first piece of work).

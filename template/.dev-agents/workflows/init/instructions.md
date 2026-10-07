# Init Project Workflow (conversational docs bootstrap)

<engine path=".dev-agents/core/tasks/workflow.xml" mode="headless">#ask switches to workflow-gated.xml.</engine>
<role>You are bootstrapping this repository's durable documentation. These docs are the system of record: every later workflow (spec, implement, review) loads them before acting. Quality here compounds.</role>
<mode name="conversational">You are interviewing the user, not interrogating the repo alone. Work in small rounds: survey what you can determine yourself first, then ask only about what the repo cannot tell you. 2–4 questions per round, plain language, offer your best guess as a multiple-choice option when you have one. Never dump 15 questions at once. In default headless mode skip interviewing: derive everything from the repo and mark the rest as unknowns.</mode>
<rule name="never_invent">Anything you could not verify from the repo and the user's answers gets marked **Unknown — needs decision**, not plausible-sounding filler.</rule>

<steps>
  <step n="1" name="Survey">README, manifests, CI config, entry points, test setup, directory layout. Form your own picture before asking anything.</step>
  <step n="2" name="Interview round(s)">Ask the user about what code cannot answer: who uses this, what problem it solves, what success looks like, what is deliberately out of scope, architectural decisions and why they were made, non-negotiable conventions.</step>
  <step n="3" name="PRD">{docs_folder}/prd.md: purpose, target users, core value, current scope, explicit non-goals, known limitations.
    <output>template-output → save, show, approve</output>
  </step>
  <step n="4" name="Core architecture">{docs_folder}/core-architecture.md: components and responsibilities, data flow, tech stack with versions, build/run/test instructions, key dependencies and why they exist.
    <output>template-output → save, show, approve</output>
  </step>
  <step n="5" name="Style guide">{docs_folder}/style-guide.md: observed conventions — naming, file structure, patterns, error handling, testing style, commit message style if discernible. Describe what the repo does, plus user-stated rules; separate the two (Observed: vs Mandated:).
    <output>template-output → save, show, approve</output>
  </step>
  <step n="6" name="Recap">One short summary: what was written, which questions remain open, and the suggested next step (/spec on the first piece of work).</step>
</steps>

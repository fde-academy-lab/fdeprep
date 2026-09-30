---
name: documentation-standard
description: The standard for the README and every page a person reads in this repository, from docs/project to a runbook. Use when writing or rewriting a README, a spec page, a delivery page, a runbook or release notes, and before committing any of them. Sets what goes at the top, which diagrams and tables a document needs, how facts and estimates are marked, and the writing pass every page gets last.
---

# Documentation standard

A document here has two readers at once: someone deciding whether the product is
worth their time, and someone about to run it. The first gets an answer from the
top screen. The second finds every step without asking anybody.

## Before writing

1. Name the reader, what they do right after reading, and how much time they
   have. A README serves a first-time visitor for about two minutes and an
   operator for as long as setup takes, so write both paths and keep them apart.
2. For anything longer than a page, show a one-screen outline first: the
   sections, and the one sentence each section must deliver. Rejecting an
   outline costs a minute; rejecting a finished page costs the page.
3. Collect every figure from its source. Test counts come from the test
   runners, dates and pull requests from git and GitHub, sizes and estimates
   from `docs/project/backlog.yaml`. A figure remembered from an earlier
   session is a guess.

## Which skill does what

The vendored skills are not loaded automatically. Read the one the task needs.

| Task | Read |
|---|---|
| The last pass on every document | `.claude/skills/vendor/humanizer/SKILL.md` |
| The structure of a README, runbook or API page | `.claude/skills/vendor/knowledge-work/engineering/skills/documentation/SKILL.md` |
| Requirements, constraints, trade-offs and diagrams | `.claude/skills/vendor/knowledge-work/engineering/skills/system-design/SKILL.md` |
| A decision record | `.claude/skills/vendor/knowledge-work/engineering/skills/architecture/SKILL.md` |
| A roadmap page with RICE and Now, Next and Later | `.claude/skills/vendor/knowledge-work/product-management/skills/roadmap-update/SKILL.md` |
| Sprint and capacity planning | `.claude/skills/vendor/knowledge-work/product-management/skills/sprint-planning/SKILL.md` |
| A status update for management | `.claude/skills/vendor/knowledge-work/product-management/skills/stakeholder-update/SKILL.md` |
| A spec for a new feature | `.claude/skills/vendor/knowledge-work/product-management/skills/write-spec/SKILL.md` |

When they disagree, this order decides: `.claude/rules/02-writing.md` and
`CLAUDE.md` first, then this file, then the humanizer, then the knowledge-work
skills. The knowledge-work templates separate parts of a line with dashes, put
a bold label on every line and report status as a colour word, and none of that
survives the humanizer pass. Their steps that begin "If ~~project tracker is
connected" do not apply here: the delivery record is
`docs/project/backlog.yaml`, so read that instead.

## The README

Sections in this order. Leave out a section with nothing true to say rather
than pad it.

| Section | What it must deliver |
|---|---|
| Opening | What the product is and who it is for in two sentences, then one line with the current build stage and its date. |
| How to use it | Numbered steps through the key screens, each with a labelled screenshot, as the Screenshots section below describes. |
| Who it is for | A table of the people who use it and what each does with it: learners, faculty, placement teams, operators, and anyone outside FDE Academy preparing for a forward deployed or agent engineering role. |
| Key features | A table giving each feature, what the user gets from it, and where it lives. |
| Modes | Every mode the product supports and what changes in each: difficulty from Easy to Extreme, the guided, unguided and pressure voice modes, rehearsal, development against production, and local against AWS. |
| Stages of development | POC, MVP, alpha and beta, with dates, what each proved and the stages each spans, taken from `docs/project/delivery-history.md`. |
| Spec at a glance | One row per numbered document in `docs/`, saying what it decides and when to read it. |
| Architecture | The diagrams in the next section. |
| Requirements | Functional requirements; non-functional requirements, each with a measurable target and the test or check that verifies it; constraints; and assumptions, each with what happens if it is wrong. Every row has an ID a test or a document can cite. |
| Running it | Local first, then AWS. Every command can be pasted as it stands, and each says what it prints when it works. |
| Quality | The suites, what each covers and its current count, re-measured on the day of writing. |
| Project record | A link to `docs/project/` for the history, roadmap, estimates and risks. |

## Diagrams

Mermaid in fenced blocks, because GitHub renders it where the reader already is.

| Diagram | Mermaid type | What it shows |
|---|---|---|
| C4 level 1, context | `flowchart` | The people and outside systems around the product. |
| C4 level 2, containers | `flowchart` | Each deployable unit with its technology, and which talks to which. |
| C4 level 3, components | `flowchart` | The inside of the one container a reader most needs to understand. |
| Deployment | `flowchart` | Where each container runs on AWS, and the network boundaries between them. |
| Trust boundaries | `flowchart` | What each boundary keeps out, from `.claude/rules/01-trust-boundaries.md`. |
| Sequence | `sequenceDiagram` | One per main flow, for example a code submission from the click to the verdict. |
| State | `stateDiagram-v2` | Every entity with a lifecycle, for example a submission or an evaluation. |
| Entity relationship | `erDiagram` | The core tables and their keys. |

Draw the C4 levels as flowcharts that keep C4's conventions: each person,
system and container is a box labelled with its name, its technology and one
line of purpose, and every arrow carries a verb. Mermaid's own C4 syntax is
marked experimental in its documentation and places shapes in the order they
are written (checked on mermaid.js.org on 30 September 2026), so a flowchart
renders more reliably.

A diagram states only what the code does. Take table names and columns from the
migrations, and services from `infra/`. Render every diagram before committing,
with the Mermaid validation tool when the session has one and otherwise in the
pull request's preview on GitHub. A diagram GitHub cannot render is worse than
no diagram.

## Screenshots

- Capture from the running app with Playwright against seeded development data,
  at a fixed viewport, so a later capture matches.
- Add the labels in the page before capturing, as numbered markers from an
  injected stylesheet, so a later capture reproduces them exactly. The step
  text refers to the numbers.
- Save each as a PNG under `docs/images/` with a name that says which screen it
  shows, and give it alt text that says what the reader should notice.
- Show no personal data. Seed a named test learner instead.

## Figures and claims

- Mark every figure as a fact, with where it came from, or as an estimate, with
  how it was made. `docs/project/estimation.md` is the model to follow.
- Give a library, API or service claim the version or the date it was checked
  against.
- Keep generated numbers generated. The tables in `docs/project` come from
  `python -m tools.project_sync --render-docs`, and a hand edit to one is
  overwritten on the next run.

## The writing pass

Last, on every page, read the humanizer skill and apply it. The rules most
often broken in this repository's documents:

- No dash as punctuation, em or en, anywhere, including tables and code
  comments shown on the page.
- No word from the list in `.claude/rules/02-writing.md`, and none of
  Additionally, Moreover, However, Hence, Thus, Nonetheless, Furthermore,
  Accordingly, Indeed or Dynamic.
- Full sentences in bullets and in any table cell that carries prose. A name or
  a number can stand alone in a cell.
- No "not X but Y", no closing line that repeats the point, no list of three
  for rhythm, and no bold label on every item.
- No sentence about the document itself or how it was made. "You" means the
  person reading the page.
- Sentence-case headings.

Tests check the banned words and the dashes in `problems/` and `docs/project/`.
Check any other page by hand before committing:

```bash
grep -nE "$(printf '\342\200\224|\342\200\223')" FILE
grep -niwE 'additionally|moreover|however|hence|thus|nonetheless|furthermore|accordingly|indeed|dynamic|delve|leverage|robust|seamless|holistic|unlock|elevate|crucial|pivotal|myriad|plethora|tapestry|landscape|realm|beginner' FILE
```

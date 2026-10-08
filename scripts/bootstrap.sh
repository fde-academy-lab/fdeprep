#!/bin/bash
# FDE Prep bootstrap.
#
# Creates the .claude/ agent configuration and .gitignore inside the repository.
# These cannot be added through GitHub's web uploader, which silently skips any
# folder whose name begins with a dot.
#
# Run this once, from a Claude Code session, then commit and push to main.
# Everything it writes is idempotent, so running it twice is harmless.
#
#   bash scripts/bootstrap.sh                 config only
#   bash scripts/bootstrap.sh --with-skills   also vendor third-party skills
#
# After it finishes, commit:
#   git add -A && git commit -m "chore: agent configuration" && git push

set -euo pipefail

WITH_SKILLS=0
[ "${1:-}" = "--with-skills" ] && WITH_SKILLS=1

# Allowlist entries that turned out not to exist at their pinned ref. Collected
# across every repo and reported together at the end, so one run tells you
# everything to fix rather than one thing at a time.
VENDOR_ERRORS=""

if [ ! -f CLAUDE.md ] || [ ! -d docs ]; then
  echo "Run this from the repository root. Expected CLAUDE.md and docs/ here."
  exit 1
fi

say() { echo "[bootstrap] $*"; }

mkdir -p .claude/rules .claude/skills

say "writing .claude/settings.json"
cat > ".claude/settings.json" <<'__FDEPREP_01__'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR\"/scripts/install_pkgs.sh"
          }
        ]
      }
    ]
  }
}
__FDEPREP_01__

say "writing .claude/rules/01-trust-boundaries.md"
cat > ".claude/rules/01-trust-boundaries.md" <<'__FDEPREP_02__'
# Trust boundaries

These hold in every phase. A change that weakens one of them is a change to the
security model and needs saying out loud in the pull request, not a silent edit.

## The two Lambdas never merge

The runner executes learner code. It has no Bedrock permission, no database
credential, no bucket and no queue, and sits in a VPC with no internet route
and no endpoint. The judge calls models and never executes learner code. The
worker invokes each one directly and writes what comes back; neither function
writes a result anywhere itself (amended 30 September 2026, when results
stopped travelling through a queue).

The web host holds no model credential either: the judge function does. A
production worker refuses to run learner code on its own host unless
`RUNNER_LOCAL_OK=1` says somebody meant it.

If a task seems to need learner code to call a model, use the step protocol in
`docs/03-RUNNER-AND-GRADING.md` section 9.4 instead.

## Hidden means unpublished, not unreadable

Learner code can read anything staged into its own process. Stage one case, or
a bounded batch, per invocation. Never stage an expected output next to an
input. Comparison happens in the trusted evaluator, outside the sandbox.

## The harness lives in the runner, and the sandbox holds proxies

Learner code calls `llm` and `tools`, and each call crosses a pipe to the
runner, which runs the scripted model and the fixtures and records the trace.
The script, the fixtures, the budget and the trace are never in the sandbox's
process. `llm._script` was the whole scripted model, which turns a problem
into a lookup, and `llm._trace` was the trace every count is recomputed from,
which is how a solution would write tool calls that never happened. Neither
exists in the sandbox now, so do not move either back.

The static gate still rejects a private attribute read on anything other than
`self`, `cls` or `super()`, and the public routes to the interpreter's own
modules. That gives an honest learner a named reason. It is not the boundary:
the boundary is that nothing worth reaching is in the process.

The sandbox starts with an allowlisted environment, no process allowance, and
a runner that is not dumpable. The runner's environment holds the execution
role's credentials, so none of those three is optional.

## Never trust learner-reported anything

Pass counts, timings and result summaries printed by learner code are strings,
not facts. Parse bounded schema-valid output, then judge correctness
independently against values generated in the trusted path.

## Client input is never authoritative

The browser may not supply a sandbox id, an execution role, a model
identifier, a storage path, a difficulty, or a cap allowance. Every one of
those is resolved server-side from the enrolment and the problem version.

## A read-only editor range is not a boundary

Allowed edit regions on prompt-surgery problems are enforced on the server.
The editor's read-only styling is an affordance.

## An error verdict never consumes an allowance

Infrastructure failures are the platform's problem, not the learner's. This is
tested, not assumed.

## Prompt injection reaches the judge as data

Learner text going to a judge is wrapped in delimiters and labelled as data.
Judge output is parsed as JSON against a schema and rejected when it does not
conform. A design answer asking for full marks scores on content.
__FDEPREP_02__

say "writing .claude/rules/02-writing.md"
cat > ".claude/rules/02-writing.md" <<'__FDEPREP_03__'
# Writing rules for anything a person reads

Applies to learner-facing copy, error messages, empty states, pull request
bodies and documentation. Not to code comments.

## Say the thing

No "not X, but Y" constructions. No three clipped sentences in a row for
emphasis. No hedge openers: "it is worth noting", "it is important to
understand", "when it comes to". Delete the opener and the sentence after it
is the sentence.

## Every sentence carries a fact or a decision

Sentences that only manage the reader's expectations get deleted.

## Error messages name the next action

"Submission failed" is not a message. "The runner timed out after 10 seconds.
Your attempt was not counted. Try again." is a message.

## Learner-facing vocabulary

Never use "beginner". Never call the baseline diagnostic a test. Difficulty
labels are Easy, Medium, Hard and Extreme, and nothing else.

## No AI register

Avoid: delve, leverage as a verb, robust, seamless, holistic, unlock, elevate,
crucial, pivotal, myriad, plethora, tapestry, landscape, realm. The plain word
is shorter and reads as written by a person.

## Pick one noun and repeat it

Do not rename the same concept three ways in one screen. Repetition reads as
rigour; variation reads as uncertainty.
__FDEPREP_03__

say "writing .claude/skills/problem-authoring/SKILL.md"
mkdir -p ".claude/skills/problem-authoring"
cat > ".claude/skills/problem-authoring/SKILL.md" <<'__FDEPREP_04__'
---
name: problem-authoring
description: Author a new FDE Prep practice problem as validated YAML with public, hidden and adversarial tests, a reference solution and a naive solution that provably fails. Use whenever a new code, prompt or design problem is being written, or an existing one is being revised, or a topic from the catalogue backlog is being turned into a real problem.
---

# Problem authoring

Read `docs/04-PROBLEM-AUTHORING.md` before writing anything. This skill is the
loop, that document is the schema.

## The loop, in order

1. **Pick the failure, not the topic.** A problem exists to make one specific
   mistake happen. Write that mistake down in one sentence before anything
   else. If you cannot, there is no problem here yet.
2. **Write the brief as a situation.** Somebody is asking for something. The
   learner should be able to picture who. A brief that opens "implement a
   function that" is a task, and tasks teach nothing.
3. **Write the naive solution first.** The one an unprepared learner writes in
   four minutes. Save it as `naive_solution.py`.
4. **Write the hidden tests that catch it.** At least one hidden test must fail
   against the naive solution. If none do, the problem is decorative.
5. **Write the reference solution.** Save as `reference_solution.py`. Solve it
   from the stub in the editor, under the time estimate, without looking at
   the tests you wrote.
6. **Pick adversarial fixtures.** Hard and Extreme need at least one. Each
   carries an `annotation_md` that explains the trap after the attempt closes.
7. **Set the call budget** one above a clean solution and at least two below
   the naive one.
8. **Write hints as a narrowing sequence.** Hint one narrows the search space.
   Hint two names the mechanism. Hint three describes the shape of the fix. No
   hint contains the answer.
9. **Run the validator.** `python -m scripts.validate_problem <path>`.
10. **Run it through the runner.** `python -m runner.local <problem.yaml>
    <reference_solution.py>` must pass every gate, and the naive solution must
    fail at least one hidden test. Commit both results in the pull request body.

## Refuse to proceed when

- The topic has no source material and you would be inventing what an
  interviewer asks. Say so and ask. A thin problem is worse than a missing one.
- The naive solution passes everything you can think of. Either the problem is
  too easy for its tier or the hidden tests are wrong.
- You are tempted to write a seventh test because six felt thin. Count the real
  distinct failures instead.

## Never

- Put an expected output anywhere the sandbox can read it.
- Copy a problem statement, test or solution from another practice product.
- Add a competency tag outside the fixed vocabulary in `docs/00-PRD.md`.
- Mark a problem published. Author it review-ready and let a human publish.
__FDEPREP_04__

say "writing .claude/skills/voice-question-authoring/SKILL.md"
mkdir -p ".claude/skills/voice-question-authoring"
cat > ".claude/skills/voice-question-authoring/SKILL.md" <<'__FDEPREP_05__'
---
name: voice-question-authoring
description: Author a Voice Screen interview question with beats, live cue anchors, a rubric and three exemplar transcripts. Use whenever a spoken interview question is being written or revised for FDE Prep, or an entry from the interview bank is being turned into a runnable voice question.
---

# Voice question authoring

Read `docs/07-VOICE-SCREEN.md` sections 2 and 6 first.

## The loop

1. **Write the question as something a person says.** A client, an
   interviewer, a colleague. Not a prompt.
2. **Speak the strong answer out loud and time it.** That duration, rounded up,
   is `total_seconds`. Do not guess it. A question budgeted from imagination is
   always too short.
3. **Break that answer into four to six beats.** Three is not a pathway, seven
   is a script. Each beat is one move in the argument, not one topic.
4. **Budget each beat** from your own timed reading, not evenly.
5. **Write anchors from your own transcript.** Anchors are words a real answer
   actually contains. They drive live cue lighting through plain substring
   matching, so they must be phrases someone would say out loud, not jargon
   they would write.
6. **Write three exemplars as transcripts.** Spoken English, with the
   hesitations left in. Strong, adequate, weak. A polished written paragraph
   anchors the judge wrongly and every learner scores low against it.
7. **Write the rubric last**, so it describes what separated your three
   exemplars rather than what you hoped it would measure.
8. **Write follow-ups for Pressure mode** that attack the weakest load-bearing
   claim in the strong answer.

## Anchors are landmarks, not answers

`degrade` tells a learner there is territory here. It does not tell them what
to say about it. If an anchor list reads as an answer key, cut it back.

## Never

- Score fluency, accent, pace against a native-speaker band, or filler rate.
  Delivery metrics are reported and never scored. This is not a preference.
- Write an exemplar in written register.
- Put probe or follow-up text anywhere the learner can read it before they pass.
__FDEPREP_05__

say "writing .claude/skills/spec-check/SKILL.md"
mkdir -p ".claude/skills/spec-check"
cat > ".claude/skills/spec-check/SKILL.md" <<'__FDEPREP_06__'
---
name: spec-check
description: Check a diff against the standing rules in CLAUDE.md and .claude/rules. Use before every pull request on this repository, before any push straight to main under the configuration exception in CLAUDE.md, and whenever asked whether a change is safe to ship.
---

# Spec check

Run against the diff you are about to publish: since the branch point for a
pull request, or since `origin/main` for a push straight to `main`. Report
violations with file and line. Do not fix them silently; list them and let the
author decide.

## Checks, in order of how much damage they do

1. **Learner code reaching a model.** Any import, client, credential or network
   call in `runner/` that could reach Bedrock or any model endpoint.
2. **Expected outputs staged into the sandbox.** Any path where a hidden test's
   expected value is written into the runner working directory.
3. **A component reading `difficulty` directly.** Everything asks the policy
   module. Grep for the field outside `lib/policy/`.
4. **A cap consumed on an error verdict.** Any counter increment that is not
   guarded on a terminal non-error verdict.
5. **Transcript rendering during an answer.** Any component under the Voice
   Screen that renders transcript text while a session is active.
6. **Delivery metrics escaping the debrief.** Words per minute, filler count or
   pause length appearing in a score, the competency heatmap, or the CSV export.
7. **A judge prompt in the database.** Judge prompts live in `judge/prompts/`.
8. **A migration that breaks the previous release.** A column dropped or renamed
   in the same release it stopped being used.
9. **A new assertion type without a fixture, a unit test and a validator entry.**
10. **A secret, an AWS key, or a credentialed database URL in the diff.**

## On a push straight to `main`

The configuration exception in `CLAUDE.md` sends these commits to `main` with no
reviewer, so this skill is the only gate they pass. Check ten above with more
care than usual, then three more:

11. **A file outside the configuration paths.** `CLAUDE.md` lists them. One file
    from `web/`, `runner/`, `judge/`, `infra/`, `.github/workflows/` or `docs/`
    in the diff sends the whole change to a branch, including the configuration
    part of it.
12. **A new entry in a vendored-skill allowlist.** The `*_KEEP`, `*_EXTRAS`
    and `*_FILES` lists in `scripts/bootstrap.sh` decide which third-party
    agent instructions land in this repository. A line added there needs the commit
    message to say what the skill does and whether it runs shell commands or
    fetches from the network. Without that, an unreviewed instruction set just
    entered the repository.
13. **A commit message that would not serve as a pull request body.** It is the
    only record of what changed and why.

## Also report

- Any library, API version or model identifier asserted without a documentation
  check recorded in the pull request body, or in the commit message on a push to
  `main`.
- Any new dependency that duplicates one already present.
- Any writing in `.claude/rules/02-writing.md`'s banned register that appears in
  learner-facing copy.

## Output shape

One table: rule, file and line, one sentence on what is wrong. Then a single
verdict line: safe to ship, or not, and why. On a push to `main`, "not" means
the change goes to a branch and opens a pull request instead.
__FDEPREP_06__

say "writing .claude/skills/documentation-standard/SKILL.md"
mkdir -p ".claude/skills/documentation-standard"
cat > ".claude/skills/documentation-standard/SKILL.md" <<'__FDEPREP_08__'
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
__FDEPREP_08__

say "writing .gitignore"
cat > ".gitignore" <<'__FDEPREP_07__'
# secrets
.env
.env.*
!.env.example
*.pem
*.key

# node
node_modules/
.next/
out/
.turbo/

# panelist 2's embedding model: 46MB, fetched by
# scripts/fetch_embedding_model.py and pinned by checksum there.
.models/

# python
__pycache__/
*.pyc
.venv/
.pytest_cache/
.ruff_cache/

# infra
cdk.out/
.aws-sam/

# local
.DS_Store
coverage/
playwright-report/
test-results/

# learner audio must never land in git
# docs/07 section 7 "Capture": 16kHz mono PCM streamed to Transcribe, plus a
# MediaRecorder copy for playback. MediaRecorder emits webm on Chromium and
# mp4/m4a on Safari.
*.wav
*.webm
*.mp3
*.m4a
*.mp4
*.ogg
*.opus
*.flac
*.pcm

# next / typescript build output
web/.next/
web/out/
*.tsbuildinfo

# `next dev` writes these on every run: AGENTS.md carries Next.js's own agent
# instructions and CLAUDE.md is a one-line include of it. Ignored rather than
# committed, because a file that steers every future agent session in this
# repository should arrive by a decision someone made, not as a side effect of
# starting the dev server. The generated file argues for committing it; that is
# the tool's opinion about its own output, not a review.
web/AGENTS.md
web/CLAUDE.md

# CDK synth output. The template is generated from infra/lib and asserted in
# infra/test, so a committed copy would just be a second thing to keep current.
infra/cdk.out/
.claude/worktrees/
__FDEPREP_07__

# ---------------------------------------------------------------------------
# Optional: vendor third-party agent skills into the repository.
#
# Repo .claude/skills/ is the only skill route that works reliably in a cloud
# session. The /plugin command is terminal-only and does nothing here.
#
# Only the skills named in the allowlists below are copied in. A skill is
# instructions an agent follows, and some of them run shell commands or fetch
# from the network, so the default is to take nothing and add deliberately.
# ---------------------------------------------------------------------------
if [ "$WITH_SKILLS" = "1" ]; then
  DEST=".claude/skills/vendor"
  mkdir -p "$DEST"

  # Pinned to the commits actually reviewed and vendored: the first two on
  # 2026-09-13, the documentation pair on 2026-09-30. Move a pin only after
  # reading the diff. Find a newer SHA with:
  #   git ls-remote https://github.com/<owner>/<repo> main
  MATTPOCOCK_REF="3cca18b368ae95cdbdebbff572ccafa662551015"
  ANTHROPIC_REF="34040c9c568585f6929bedeaad110ad08f079624"
  KNOWLEDGE_WORK_REF="da38ec1ee89d41e5380e652a97382695003396e7"
  HUMANIZER_REF="225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8"
  # Added 2026-10-08 at the product owner's request, each read before pinning.
  PONYTAIL_REF="b088b2df6e08d4306c6a3c3d575fe38c2d2d2989"
  KARPATHY_REF="2c606141936f1eeef17fa3043a72095b4765b9c2"
  TASTE_REF="b482f7a970abb98c4108d4a9f761e458c64cefc8"
  UI_UX_PRO_MAX_REF="1a2c459b35f26116fd165b0a0f30597f252749ff"
  # Added 2026-10-08 at the product owner's request, read before pinning.
  HERDR_REF="2563803dca97c040beaf3dc3acdcb5a3221b4238"

  # Allowlists. Paths are relative to each repo's skills/ directory, and nothing
  # outside these lists is copied, so a re-run cannot restore a skill that was
  # reviewed and rejected. Of the 56 skills these two repos ship, 17 are taken.
  #
  # The rule used to build these: keep a skill only if it changes how code gets
  # designed, written, tested, reviewed or shipped in a TypeScript/Next.js plus
  # Python plus AWS repository. That dropped the document-production skills
  # (docx, pptx, xlsx, pdf), the design-asset skills, the two that impose a
  # ready-made visual identity and so collide with docs/08 (brand-guidelines,
  # theme-factory), the conversation-management skills, the eight the upstream
  # author marks in-progress, and the mattpocock skills that need a configured
  # issue tracker this repo does not use.
  #
  # Adding a line here vendors an agent instruction set into the repo. Read the
  # SKILL.md first, check whether it runs shell commands or fetches from the
  # network, and say so in the pull request.
  MATTPOCOCK_KEEP="
engineering/code-review
engineering/codebase-design
engineering/diagnosing-bugs
engineering/domain-modeling
engineering/grill-with-docs
engineering/prototype
engineering/research
engineering/resolving-merge-conflicts
engineering/tdd
engineering/wizard
misc/setup-pre-commit
productivity/grill-me
productivity/grilling
productivity/teach
productivity/writing-for-agents
"

  ANTHROPIC_KEEP="
claude-api
frontend-design
webapp-testing
"

  # Documentation, added 2026-09-30 for the README and the delivery pages in
  # docs/project. The rule above dropped the document-production skills
  # because they make files in formats this repository does not ship. These
  # write Markdown, which it does. .claude/skills/documentation-standard says
  # how they combine and which one wins when they disagree.
  #
  # Each is instructions only: no shell command and no fetch. The
  # knowledge-work skills mention placeholders such as ~~project tracker for a
  # tool a session might have connected. Nothing here connects one and no
  # .mcp.json is copied, so those branches do nothing unless a session already
  # has that connector. Of the 252 skills that repository ships, 7 are taken.
  KNOWLEDGE_WORK_KEEP="
engineering/skills/architecture
engineering/skills/documentation
engineering/skills/system-design
product-management/skills/roadmap-update
product-management/skills/sprint-planning
product-management/skills/stakeholder-update
product-management/skills/write-spec
"
  # The skills above link to the CONNECTORS.md at their plugin's root, and the
  # Apache 2.0 licence travels with the copy.
  KNOWLEDGE_WORK_EXTRAS="LICENSE product-management/LICENSE engineering/CONNECTORS.md product-management/CONNECTORS.md"

  # blader/humanizer is one skill whose SKILL.md sits at the repository root,
  # beside a README, packaging for other agents and a validator script the
  # skill never calls. Only these files are copied.
  HUMANIZER_FILES="SKILL.md LICENSE"

  # Added 2026-10-08. Each kept skill is instructions only: no shell command
  # and no fetch, except ui-ux-pro-max, whose scripts/ search the CSV files it
  # ships (python3, standard library, no network). ponytail's hooks and
  # installers are not copied, only its two SKILL.md files; the karpathy
  # repository carries no LICENSE file and states MIT in its README and in the
  # skill's frontmatter.
  #
  # taste and ui-ux-pro-max propose visual identities, which the rule above
  # keeps out because docs/08 owns every styling decision. They come in as
  # audit and anti-slop discipline only: where they disagree with docs/08,
  # docs/08 wins, and neither may pick a font, a colour or a motion curve.
  PONYTAIL_KEEP="
ponytail
ponytail-review
"
  KARPATHY_KEEP="
karpathy-guidelines
"
  TASTE_KEEP="
taste-skill
redesign-skill
minimalist-skill
"
  UI_UX_PRO_MAX_KEEP="
ui-ux-pro-max
"

  # herdrdev/herdr is a terminal multiplexer for coding agents, Apache 2.0.
  # Its one skill runs the herdr command line, and only after checking
  # HERDR_ENV=1, which says the agent sits in a Herdr pane; anywhere else it
  # says so and stops, so in a cloud session it does nothing. No fetch. The
  # three skills under .agents/ are the herdr maintainers' own release tooling
  # and are not taken.
  HERDR_KEEP="
herdr
"

  # A pinned SHA is not a branch, so the first clone form always fails on one
  # and the fallback is what actually does the work. Both are kept: the shallow
  # form is faster whenever a ref is a branch name again.
  clone_at() {
    git clone --quiet --depth 1 --branch "$2" "https://github.com/$1" "$3" 2>/dev/null \
      || { git clone --quiet --filter=blob:none --no-checkout "https://github.com/$1" "$3" \
           && git -C "$3" checkout --quiet "$2"; }
  }

  # Extras are single files copied at their own paths, for what a kept skill
  # links to or a licence asks to keep with the copy.
  fetch_skills() {
    repo="$1"; ref="$2"; name="$3"; subdir="$4"; keep="$5"; extras="${6:-}"
    listname="$(printf '%s' "$name" | tr '[:lower:]-' '[:upper:]_')_KEEP"
    tmp="$(mktemp -d)"
    say "fetching $repo @ $ref"

    if ! clone_at "$repo" "$ref" "$tmp"; then
      say "  could not fetch $repo, continuing"
      rm -rf "$tmp"
      return 0
    fi

    if [ ! -d "$tmp/$subdir" ]; then
      say "  no $subdir/ in $repo, leaving $DEST/$name untouched"
      rm -rf "$tmp"
      return 0
    fi

    # Everything upstream ships, so the run can report what it declined to take.
    find "$tmp/$subdir" -name SKILL.md -exec dirname {} \; \
      | sed "s|^$tmp/$subdir/||" | sort > "$tmp/.upstream"
    printf '%s\n' "$keep" | sed '/^[[:space:]]*$/d' | sort > "$tmp/.keep"

    rm -rf "${DEST:?}/$name"
    mkdir -p "$DEST/$name"

    copied=0
    missing=""
    while IFS= read -r path; do
      [ -z "$path" ] && continue
      if [ -d "$tmp/$subdir/$path" ]; then
        mkdir -p "$DEST/$name/$(dirname "$path")"
        cp -R "$tmp/$subdir/$path" "$DEST/$name/$(dirname "$path")/"
        copied=$((copied + 1))
      else
        missing="$missing $path"
      fi
    done <<__KEEPLIST__
$keep
__KEEPLIST__

    for file in $extras; do
      if [ -f "$tmp/$file" ]; then
        mkdir -p "$DEST/$name/$(dirname "$file")"
        cp "$tmp/$file" "$DEST/$name/$file"
      else
        missing="$missing $file"
      fi
    done

    sha="$(git -C "$tmp" rev-parse HEAD 2>/dev/null || echo "$ref")"
    upstream_total="$(wc -l < "$tmp/.upstream" | tr -d ' ')"
    declined="$(comm -13 "$tmp/.keep" "$tmp/.upstream" | wc -l | tr -d ' ')"

    {
      echo "$repo@$sha"
      echo "curated subset: $copied of $upstream_total skills upstream ships at this ref."
      echo "The allowlist is $listname in scripts/bootstrap.sh."
      echo "This folder is not a mirror. Do not re-add a skill by hand; add it to the list."
    } > "$DEST/$name/.source"

    say "  vendored $copied of $upstream_total, declined $declined"

    # A path in the list that is not in the clone means the pin moved under the
    # allowlist or upstream renamed something. Silence here would lose a skill
    # nobody decided to drop, so record it and keep going: every other repo
    # still gets vendored, and the run reports the whole list at the end.
    if [ -n "$missing" ]; then
      for path in $missing; do
        say "  MISSING: $path"
        VENDOR_ERRORS="$VENDOR_ERRORS$path  (in $listname, from $repo @ $ref)
"
      done
    fi

    rm -rf "$tmp"
  }

  # A repository that is a single skill keeps SKILL.md at its root. Only the
  # named files are copied, so nothing else it ships lands here.
  fetch_root_skill() {
    repo="$1"; ref="$2"; name="$3"; files="$4"
    listname="$(printf '%s' "$name" | tr '[:lower:]-' '[:upper:]_')_FILES"
    tmp="$(mktemp -d)"
    say "fetching $repo @ $ref"

    if ! clone_at "$repo" "$ref" "$tmp"; then
      say "  could not fetch $repo, continuing"
      rm -rf "$tmp"
      return 0
    fi

    rm -rf "${DEST:?}/$name"
    mkdir -p "$DEST/$name"
    for file in $files; do
      if [ -f "$tmp/$file" ]; then
        cp "$tmp/$file" "$DEST/$name/$file"
      else
        say "  MISSING: $file"
        VENDOR_ERRORS="$VENDOR_ERRORS$file  (in $listname, from $repo @ $ref)
"
      fi
    done

    sha="$(git -C "$tmp" rev-parse HEAD 2>/dev/null || echo "$ref")"
    {
      echo "$repo@$sha"
      echo "one skill: only $files copied from the repository root."
      echo "The list is $listname in scripts/bootstrap.sh."
      echo "This folder is not a mirror. Do not add a file by hand; add it to the list."
    } > "$DEST/$name/.source"

    say "  vendored $files"
    rm -rf "$tmp"
  }

  fetch_skills "mattpocock/skills" "$MATTPOCOCK_REF" "mattpocock" "skills" "$MATTPOCOCK_KEEP"
  fetch_skills "anthropics/skills" "$ANTHROPIC_REF"  "anthropic"  "skills" "$ANTHROPIC_KEEP"
  fetch_skills "anthropics/knowledge-work-plugins" "$KNOWLEDGE_WORK_REF" "knowledge-work" "." \
    "$KNOWLEDGE_WORK_KEEP" "$KNOWLEDGE_WORK_EXTRAS"
  fetch_root_skill "blader/humanizer" "$HUMANIZER_REF" "humanizer" "$HUMANIZER_FILES"
  fetch_skills "DietrichGebert/ponytail" "$PONYTAIL_REF" "ponytail" "skills" "$PONYTAIL_KEEP" "LICENSE"
  fetch_skills "forrestchang/andrej-karpathy-skills" "$KARPATHY_REF" "karpathy" "skills" "$KARPATHY_KEEP"
  fetch_skills "leonxlnx/taste-skill" "$TASTE_REF" "taste" "skills" "$TASTE_KEEP" "LICENSE"
  fetch_skills "nextlevelbuilder/ui-ux-pro-max-skill" "$UI_UX_PRO_MAX_REF" "ui-ux-pro-max" ".claude/skills" \
    "$UI_UX_PRO_MAX_KEEP" "LICENSE"
  fetch_skills "herdrdev/herdr" "$HERDR_REF" "herdr" "skills" "$HERDR_KEEP" "LICENSE"

  say "vendored skills written to $DEST"
  say "re-running is safe: only the allowlisted skills are copied"
fi

echo
say "done. files created:"
find .claude -type f | sort | sed 's/^/[bootstrap]   /'
[ -f .gitignore ] && say "  .gitignore"
echo

if [ -n "$VENDOR_ERRORS" ]; then
  say "FAILED: these allowlist entries do not exist at their pinned ref"
  printf '%s' "$VENDOR_ERRORS" | sed 's/^/[bootstrap]   /'
  echo
  say "Upstream renamed or removed them, or a pin moved under the allowlist."
  say "Everything else was vendored, so the tree is complete apart from these."
  say "Fix the named lists in this script, then re-run. Do not commit until the"
  say "run is clean: a skill is missing here because nobody chose to drop it."
  exit 1
fi

say "next: git add -A && git commit -m \"chore: agent configuration\" && git push"

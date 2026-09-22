# FDE Prep

A practice and assessment platform for FDE Academy cohorts. Learners solve agent-engineering problems, edit system prompts, write design answers, and answer interview questions out loud, and the platform produces a readiness signal the placement side can trust.

Repository: `fde-academy-lab/fdeprep`

---

## Read these before writing code

The specification lives in `docs/` and is authoritative. When this file and a spec disagree, the spec wins, and say so rather than picking silently.

| File | Read it when |
|---|---|
| `docs/00-PRD.md` | Always, first session of any phase |
| `docs/01-WIREFRAMES.md` | Building any screen |
| `docs/02-DATA-MODEL.md` | Touching the schema or a query |
| `docs/03-RUNNER-AND-GRADING.md` | Anything in `runner/` or `judge/`, and before touching grading anywhere |
| `docs/04-PROBLEM-AUTHORING.md` | Anything that reads or validates problem YAML |
| `docs/05-DEPLOY-AND-OPS.md` | Anything in `infra/` or `.github/workflows/` |
| `docs/06-BUILD-PLAN.md` | Start of every phase, for that phase's acceptance criteria |
| `docs/07-VOICE-SCREEN.md` | Anything in the voice module |
| `docs/08-DESIGN-SYSTEM.md` | Any styling, type, colour, icon or motion decision |
| `docs/09-SOURCE-PACK-RECONCILIATION.md` | Before trusting anything in `docs/source-pack/` |
| `docs/10-EVALUATION-PANEL.md` | Anything in `eval/`, and before changing how any answer is graded |
| `docs/11-ANALYTICS-AND-REPORT-CARD.md` | Anything in `analytics/`, cohort views, the report card or an export |
| `docs/12-PROGRESS-AND-READINESS.md` | Anything in `progress/`, the heatmap or the readiness signal |

`docs/source-pack/` is an earlier build pack from a different model, kept for its
interview bank, its topic catalogue and its worked exercises. Where it disagrees
with the numbered docs, `docs/09` says which wins. Do not follow its
architecture: it chose DynamoDB, Cognito and a session-priced sandbox, and all
three were replaced for reasons recorded there.

`.claude/rules/` holds the trust boundaries and the writing rules. They load
automatically. Read them anyway at the start of a phase.

---

## Stack

TypeScript for the web application, Python 3.12 for the runner and judge. Do not introduce a third language.

- Next.js App Router, TypeScript strict, Tailwind, CodeMirror 6
- PostgreSQL 16
- AWS Lambda for the runner and the judge, SQS between them and the application, S3 for traces and audio
- Amazon Bedrock for probe calls, rubric judging and live runs

In a cloud session, use the pre-installed PostgreSQL 16 for development and tests. Do not reach for a hosted database.

---

## Standing rules

| Rule | Why |
|---|---|
| No component reads `difficulty` directly. Everything asks the policy module. | Difficulty behaviour changes often and scattered checks drift out of step. |
| The result contract in `docs/03` is the only thing the front end renders from. | Keeps presentation logic out of grading. |
| Learner code never reaches a model endpoint, in any phase, for any reason. | The one control that makes token spend bounded. |
| An `error` verdict never consumes a learner's allowance. | A learner who loses their one daily Extreme attempt to infrastructure stops trusting every score. |
| Deterministic checks run before model calls, always. | Cheaper, reproducible, and appealable. |
| Hidden means unpublished, not unreadable. Never stage an expected output where the sandbox can read it. | Learner code can read anything in its own process. |
| The submission row, the cap decrement and the queue message are written in one transaction through an outbox. | Otherwise a submission exists with no message and hangs forever. |
| A terminal verdict is committed with a compare-and-set on the runner's lease. | Stops a late or duplicated runner overwriting a fresh result. |
| Every migration stays backward compatible for one release. | Rollback has to remain possible. |
| Judge prompts live in `judge/prompts/` as files, never in the database. | A judge change should be a code review. |
| Any new assertion type ships with a fixture, a unit test and a validator entry. | Otherwise an author writes a spec that fails at run time in front of a learner. |
| Problem YAML is validated in CI, not at import. | A broken problem should never reach the import screen. |
| No transcript text renders on screen while a learner is speaking. | They read instead of speak, and the answer gets worse. |
| `eval/` is the only writer of a grade, a band or a competency state. `progress/` and `analytics/` read. | Two modules computing the same number from the same rows will eventually disagree, and nobody can tell which is right. |
| A problem that declares panelist 2 or 3 declares panelist 1 checks too. | The outage fallback has to be structural. A learner submitting during a Bedrock incident gets thinner feedback and never gets silence. |
| A panelist that cannot run never lowers a score. | Infrastructure is the platform's problem. The evaluation goes to `partial` and re-runs for free. |
| Only deterministic checks produce a terminal failure. Bands and prose never do. | A verdict nobody can reproduce is a verdict nobody can appeal. |
| Complexity (C1 to C4) and difficulty (Easy to Extreme) are separate axes. Never map one onto the other. | Complexity decides which panelists can check an answer. Difficulty decides how much support the learner gets. |
| The learner reads one consolidated voice. Panelist provenance is stored and shown only to faculty. | The learner should hear an interviewer. The appeal path needs to know which finding was deterministic. |

---

## What you must not do

- Do not run `cdk deploy`, `aws lambda update-function-code`, `vercel deploy`, or any other command that changes live infrastructure. Write the infrastructure code and the GitHub Actions workflow; a human runs the deploy. If a task seems to require deploying, stop and say so.
- Do not commit secrets, `.env` files, AWS keys, or database URLs with credentials in them.
- Do not push to `main`. Work on the branch the session starts on and open a pull request. Configuration is the one exception, and the section below says exactly what counts.
- Do not add a dependency that duplicates one already in `package.json` or `pyproject.toml`. Say what you would add and why before adding it.
- Do not copy code, markup, stylesheets or problem text from any existing interview-practice product. The feature model in `docs/` is the specification; the implementation is original work.
- Do not invent a problem, a question, a rubric or an exemplar unless the task asks for content. Building content into code makes it unreviewable.

### The configuration exception

Configuration commits go straight to `main` with no pull request, because a
review gate on the agent's own settings slows down every session that needs
them fixed. Configuration means these paths and nothing else:

| Path | What it covers |
|---|---|
| `.claude/` | Settings, rules, first-party skills and the vendored skills. |
| `CLAUDE.md` | This file, including this exception. |
| `.gitignore` | The ignore rules, which keep secrets and learner audio out of the repository. |
| `scripts/bootstrap.sh`, `scripts/install_pkgs.sh`, `scripts/cloud-setup.sh`, `scripts/sync-skills.sh` | Session and environment setup that neither CI nor the product invokes. |

Everything else opens a pull request. Three paths read as configuration and are
still code: `.github/workflows/` decides what runs on every pull request,
`infra/` is the deploy, and `docs/` is the specification the whole build answers
to. A new file under `scripts/` is configuration only while nothing in CI and
nothing in the product imports or runs it, so `scripts/validate_problem.py` is
code the day it is written.

All three of these hold, or it goes to a branch:

- The working tree holds nothing outside the paths above. A change that mixes
  configuration with code goes to a branch in full, rather than being split so
  the configuration half can skip review.
- The diff carries no secret, key or credentialed URL. That rule is two bullets
  up and it does not soften here. With no pull request there is no reviewer to
  catch it, so run `.claude/skills/spec-check` against the diff yourself first.
- The commit message carries what a pull request body would have carried: what
  changed, why, and anything you found wrong on the way. No pull request means
  the message is the only record.

---

## Verify before you assert

Library APIs, AWS service surfaces and model identifiers change. Before writing against one, check the current documentation and say in the pull request which version you verified against. This applies especially to the Amazon Transcribe streaming API, API Gateway WebSocket limits, the Bedrock model identifiers, and the AWS Lambda container image contract.

If a documented approach and your memory disagree, the documentation wins.

---

## Working style

Start each phase by reading the relevant specs and writing the acceptance tests first, before the implementation. Tests that come after the code test the code that exists rather than the behaviour required.

Commit in small units with messages that say what changed and why. When a spec is ambiguous, pick the reading that makes the deterministic path cheaper and note the choice in the pull request body rather than asking and stalling.

When something in a spec looks wrong, say so in the pull request. The specs were written before the code and some of them will be wrong.

---

## Visual direction

Build an original visual identity. `docs/01-WIREFRAMES.md` has the direction: near-black base, one accent colour used for state only, tables over cards, transitions under 150ms, no animation in results panes, every empty state naming the next action.

The Voice Screen cockpit has its own stricter rules in `docs/07-VOICE-SCREEN.md` section 3. Five live instruments maximum, one primary, colour for state only.

# FDE Prep

A practice and assessment platform for FDE Academy cohorts. Learners solve agent-engineering problems, edit system prompts, write design answers, and answer interview questions out loud. The platform produces a readiness signal the placement side can trust.

Built with Claude Code on the web against this repository.

---

## Start here

1. Read `SETUP.md`. It takes about fifteen minutes to follow end to end and it is the only thing standing between this repository and a running build.
2. Create the `fdeprep` cloud environment at <https://claude.ai/code> using `scripts/cloud-setup.sh`.
3. Open `PROMPTS.md` and run Session 0.

---

## What is in here

| Path | What it is |
|---|---|
| `CLAUDE.md` | Loads into every Claude Code session. Standing rules, stack, what not to do. |
| `SETUP.md` | Step by step: repository, GitHub App, cloud environment, credentials, skills, build order. |
| `PROMPTS.md` | One prompt per build session, eleven of them. |
| `.claude/rules/` | Trust boundaries and writing rules. Load automatically. |
| `.claude/skills/` | Three skills this build uses: problem authoring, voice question authoring, spec check. |
| `scripts/cloud-setup.sh` | Paste into the cloud environment dialog. Toolchain, databases, fonts, Playwright. |
| `scripts/install_pkgs.sh` | SessionStart hook. Starts services and installs dependencies each session. |
| `scripts/sync-skills.sh` | Run locally to vendor third-party skills, pinned to reviewed commits. |
| `docs/` | The specification. Ten numbered documents plus the earlier source pack. |

---

## The specification

Read in this order when starting a phase.

| Document | Covers |
|---|---|
| `docs/00-PRD.md` | Product contract, personas, artefact types, the scaffold ladder, rate caps, acceptance |
| `docs/01-WIREFRAMES.md` | Ten screens as region maps plus behaviour |
| `docs/02-DATA-MODEL.md` | Postgres schema, rate limit policy, competency scoring, retention |
| `docs/03-RUNNER-AND-GRADING.md` | Mock LLM contract, adversarial fixtures, grading pipeline, result contract, security, and four corrections in section 9 |
| `docs/04-PROBLEM-AUTHORING.md` | Problem YAML schema, validator rules, three worked problems, authoring checklist |
| `docs/05-DEPLOY-AND-OPS.md` | Architecture, environments, cost shape, alarms, runbook |
| `docs/06-BUILD-PLAN.md` | Nine phases with acceptance criteria and what to cut if the runway compresses |
| `docs/07-VOICE-SCREEN.md` | The voice interview simulator: guided cockpit, unguided, pressure mode, scoring, privacy |
| `docs/08-DESIGN-SYSTEM.md` | Type, colour, icons, motion, density, accessibility floor, licensing |
| `docs/09-SOURCE-PACK-RECONCILIATION.md` | What the earlier pack got right, what was corrected, what to reuse |

`docs/source-pack/` is an earlier build pack from a different model. It is kept for its interview bank, its topic catalogue and its worked exercises. Read `docs/09` before trusting its architecture.

---

## The decisions that shape everything else

**Grading is deterministic by default.** Agent problems run against a scripted mock LLM that returns pre-written responses by matching rule and never touches a network. The same submission always produces the same verdict, grading costs no tokens, and there are no appeals about randomness. Live model runs are a separate capped privilege where correctness is not judged.

**Learner code never reaches a model.** Two Lambdas with separate IAM roles: one executes learner code in a VPC with no internet route and no Bedrock permission, the other calls models and never executes learner code. Live runs go through a step protocol where the trusted worker makes the call.

**Guidance decreases with difficulty.** Six scaffold layers. Easy gets all of them and free hints. Extreme gets a brief, a blank editor, one attempt a day, and nothing else. Enforced by one policy module, not by hiding buttons.

**Every problem is open to everyone.** Personas change the recommended roadmap and nothing else. No tiers, no locked content.

**An error verdict never costs an allowance.** A learner who loses their one daily Extreme attempt to a cold start stops trusting every score on the platform.

**Spoken delivery is reported, never scored.** Words per minute, filler count and pause length appear in the voice debrief and are barred from the score, the heatmap and the placement export. Most learners here speak English as a second or third language, and scoring fluency measures the wrong thing.

---

## Stack

Next.js App Router with TypeScript for the web application. Python 3.12 for the runner and the judge. PostgreSQL 16. AWS Lambda, SQS and S3 for execution and storage. Amazon Bedrock for probes, judging and live runs. Two languages, no third.

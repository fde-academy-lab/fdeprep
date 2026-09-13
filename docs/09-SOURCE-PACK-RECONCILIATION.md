# Source pack reconciliation

`docs/source-pack/` holds an earlier build pack prepared on 14 September 2026 by a different model. It is kept because parts of it are better than this specification and its content is reusable. This file records which decisions win where the two disagree.

**Order of authority:** decisions recorded here, then `docs/00` to `docs/08`, then `docs/source-pack/`. When the source pack and a numbered doc disagree and this file is silent, the numbered doc wins and you raise the conflict in the pull request.

---

## 1. What the source pack got right, and was adopted

These are now folded into `docs/03-RUNNER-AND-GRADING.md` section 9.

| Finding | Why it matters |
|---|---|
| Hidden does not mean unreadable to candidate code | A test input staged into the sandbox is visible to the code under test. Only the expected output has to be absent. The original grading design in this pack staged fixtures in-process, which leaks them. |
| Outbox between the database write and the queue publish | Without it a submission row can exist with no queue message and hang in `queued` forever. |
| Lease and fencing token on the runner claim, compare-and-set on terminal state | Stops a slow or duplicated runner writing a stale verdict over a fresh one, and stops a late result reviving a cancelled submission. |
| Step protocol for live model runs | The candidate returns a typed action and its next state; the trusted worker calls the model and records the authoritative event. No credential ever enters learner code. This is better than any budget or broker wrapper. |
| Never trust learner-printed pass counts, timings or result summaries | Parse bounded schema-valid output, judge correctness independently. |
| Do not silently switch a sandbox to unrestricted networking because an exercise wants `pip install` | Prepackage approved dependencies instead. |
| A frontend read-only range is not a security boundary | Allowed edit regions are enforced on the server. |
| Sandbox sessions are per attempt, started and stopped, never one persistent sandbox per learner | Correct on cost and on isolation. |

Two more worth keeping as habits rather than as spec: it separated measured results from targets throughout, and it labelled its own unknowns instead of asserting them. Hold that line in the build.

---

## 2. What was corrected

### 2.1 Database: Postgres, not DynamoDB

The source pack chose DynamoDB. This build uses PostgreSQL 16.

The data is relational and the workload is reporting. Cohort heatmaps, per-competency rollups, stuck lists, CSV exports for placement, and admin filtering by learner and problem and verdict and date are all joins and aggregates. DynamoDB turns each of those into an access pattern you have to design in advance, and none of them has a scale problem worth that cost: 200 learners generate hundreds of megabytes, not terabytes.

Postgres also matches the environment. Cloud sessions have PostgreSQL 16 pre-installed, so development and tests run against the real engine rather than a local emulator.

### 2.2 Grading runner: Lambda with a pinned image, not AgentCore Code Interpreter

The source pack chose AgentCore Code Interpreter behind an adapter, with an honest two-day feasibility spike attached. Take the adapter, skip the spike, and start on Lambda.

The source pack's own numbers make the argument. Its light-session estimate is around $12 a month for 24,000 sessions and its heavy estimate around $88. Neither figure is a problem. What you buy for that money is session lifecycle management, a reaper for leaked sessions, concurrency shaping against a 30 TPS API quota, and a second set of quotas to monitor. A Lambda invocation with a pinned container image has none of that: it starts, it runs one submission, it dies, and the timeout is the cleanup.

Keep the `RunnerAdapter` interface the source pack specified. It is the right seam, and it is what makes this reversible if a later problem family genuinely needs a richer sandbox.

AgentCore earns its place in one v2 case: the problem family where a learner's agent drives a real browser. Use AgentCore Browser there.

### 2.3 Identity: GitHub OAuth, not Cognito

Every learner already has a GitHub account inside `FDE-Academy-Hub`, because GitHub is already the delivery platform. Cognito means a second identity list that has to be provisioned, reconciled and offboarded from. GitHub organisation membership is one list, already maintained, and removing a learner from the organisation removes their access here on the next session refresh.

### 2.4 Catalogue: 25 reviewed problems, not a 120-item backlog

The source pack ships 120 authoring briefs and is explicit that they are briefs rather than problems. That is honest, and the briefs are useful raw material. Keeping a 120-item backlog visible as a target is not useful, because it makes a thin problem feel like progress.

Launch on the 25 in `docs/00-PRD.md` section 9, each solved by its author from the stub, each with a naive solution that provably fails a hidden test. Mine `docs/source-pack/05-problem-catalog.json` for topics. Do not treat the count as a goal.

### 2.5 Grading default: deterministic mock LLM, live model as the capped exception

The source pack's default path is live generation through a budgeted broker with calibration to follow. That produces non-deterministic verdicts, appeals you cannot answer, and a token bill that scales with practice.

This build grades against a scripted mock LLM that returns pre-written responses by matching rule, records every call and never touches a network. The same submission always produces the same verdict. Live model runs exist as a separate capped privilege where correctness is not being judged, and they run through the step protocol from 1 above.

Calibrated semantic evaluation still applies where it is the only option: prompt-surgery probes and rubric judging. Both run last, after deterministic gates, and both anchor on three graded exemplars.

### 2.6 Front end: Next.js, not an Amplify-hosted SPA

Fewer moving parts for the same result, and server-side rendering is the natural place to enforce the guidance policy the source pack correctly insists must live on the server.

---

## 3. What the source pack missed entirely

| Gap | Where it is now |
|---|---|
| The voice interview simulator | `docs/07-VOICE-SCREEN.md` |
| `CLAUDE.md`, `.claude/` configuration, session hooks | Repository root and `.claude/` |
| Cloud environment configuration and a setup script | `SETUP.md` and `scripts/cloud-setup.sh` |
| Agent skills and plugins for the build environment | `SETUP.md` section on skills, `.claude/skills/` |
| A per-session prompt set matched to a phase and a branch | `PROMPTS.md` |
| The fairness position on scoring spoken delivery | `docs/07-VOICE-SCREEN.md` section 6 |

---

## 4. Content worth taking from the source pack

Reusable as-is or with light editing. None of it is superseded.

| Asset | Use |
|---|---|
| `09-interview-bank.md` and `.json` | 36 interview prompts with answer signals and follow-ups. Feed these into voice question authoring in Phase 8. |
| `05-problem-catalog.json` | 120 authoring briefs. Use as a topic backlog to draw the 25 launch problems from. |
| `exercises/` | Four runnable deterministic examples with starters, reference solutions and tests. Useful as contract fixtures while building the runner. Never import them as an execution path for learner code. |
| `06-example-challenge-specifications.md` | Eight worked challenge specifications across both tracks and all four difficulties. |
| `01-reference-audit.md` | The record of what was observed and what remains unknown. |

---

## 5. Two positions held from the source pack without change

**Equal access, persona-ordered recommendation.** Every published problem is visible to every enrolled learner. Personas change the roadmap and nothing else. No pricing, no subscription checks, no locked content.

**Extreme receives nothing during an active attempt.** No hints, no tutor, no solution suggestion, no decomposition. Enforced server-side, not by hiding a button.

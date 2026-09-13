# Build instructions for Claude Code or Codex

## How to use this pack

Create a fresh repository and place this pack under `docs/product/`. Give the coding agent the first prompt below. Build one working vertical slice before expanding the catalog. Use the PRD acceptance criteria as the definition of done; the wireframe communicates layout and interaction, not production architecture.

Source-of-truth order: user decisions made after this handoff; PRD; engineering/deployment specifications; problem package contracts; wireframe. When documents conflict, record the conflict and resolve it before implementing dependent behavior. The example snippets and local verifier are trusted authoring assets only. Never reuse their direct import mechanism as an execution path for uploaded learner code.

## Initial prompt: establish the repository and first slice

```text
Build FDE Academy Practice Lab from the documents in docs/product/fde-academy-build-pack.

Read README.md, 01-reference-audit.md, 02-product-requirements.md,
04-engineering-specification.md, 06-example-challenge-specifications.md and
07-deployment-and-cost.md before editing. Inspect 03-interactive-wireframe.html
for the visual direction. Treat the 120-item catalog as an authoring backlog,
not 120 completed or published problems.

First create an implementation decision log and a requirement-to-test checklist.
Then build the local vertical slice: invited-user mock identity, all-problems
library, one persona roadmap, the A004 workspace, versioned draft persistence,
public run, immutable submission, queued job state, trusted evaluation contract,
and a safe feedback result. Preserve the dark Geist visual character and use
original FDE Academy branding. Make key interactions keyboard accessible.

Use React/TypeScript and Monaco in the web app. Separate application APIs,
runner adapter, trusted evaluator and model broker. Use typed contracts.
The local mock runner must use canned outputs and be visibly labeled. Do not
execute user-supplied code in the web server or trusted API process. Build the
real isolated runner through the subsequent feasibility phase.

Every cohort member must have equal access to every published practice problem.
Personas affect recommendation order only. Implement Easy, Medium, Hard and
Extreme guidance as explicit server-side policy. Extreme receives no hints,
tutor, solution suggestions or decomposition during an active attempt.
Do not add pricing, subscription checks, fabricated mastery statistics or an
unrestricted LLM chat assistant.

Create useful implementation tests for authorization, draft conflicts,
idempotent submission, lifecycle transitions, feedback isolation and guidance
policy. Use the provided authoring examples to validate contract semantics.
Demonstrate the slice in the browser, record what is mocked versus functional,
and continue through the next phase once its prerequisites are satisfied.
Do not claim cloud readiness or 120 runnable exercises based on a rendered UI.
```

## Phase 1: prove the runner

```text
Implement the AgentCore Code Interpreter feasibility spike behind RunnerAdapter.
Verify the current AWS SDK and official documentation before writing integration
calls. Inspect the actual runtime, packages, network behavior, execution-role
credentials, session quotas, timeout/cancellation and cleanup.

Use an isolated development account or clearly separated development stack.
Use A004 as the first deterministic challenge. Keep the oracle and expected
answers in the trusted evaluator. Give candidate code only permitted files and
current inputs. Demonstrate that fake PASS output cannot change a grade and
that a candidate cannot access platform data or another session.

Add the controlled step protocol for model/tool interactions. Prove one prompt
evaluation through the server-side budgeted model broker without giving the
candidate model credentials. Do not enable Public networking as a shortcut.
If the selected runner cannot meet the documented constraints, write a concrete
adapter decision with the failing evidence before building dependent features.

Produce a repeatable smoke test, permission-boundary tests and measured session
cost/latency. Make no unapproved production resource changes.
```

## Phase 2: finish the learning workspace

```text
Complete the workspace for A004, A008, A022 and G002, then implement G001 and G009
with calibrated live evaluation. Match the guidance contract exactly. Provide
code, prompt, JSON/config and test files only where a challenge needs them.
Support immutable submission snapshots, autosave conflicts, recovery, result
version labels, cancellation, public tests, hidden failure categories, bounded
output and structured action traces.

Enforce allowed edits on the server. A frontend read-only range is not a security
boundary. A precise prompt deletion is a deterministic edit task; evaluate its
behavior separately. Solution exposure changes assistance evidence and requires
a later transfer task for independent mastery. Keep generation and judging
versions and token use with each attempt.

Demonstrate the complete path from opening the task through repairing a failure
and submitting a new artifact. Verify all four guidance levels and negative API
access checks for Hard/Extreme hints and active-assessment review material.
```

## Phase 3: persona roadmaps, interviews and cohort operation

```text
Implement three versioned recommendation roadmaps with explicit prerequisite
skills and diagnostic evidence. Keep access equal. Add the original interview
bank, answer-before-rubric flow, a technical-screen assignment, deadlines,
accommodations, allowed-assistance disclosure and instructor manual review.

Add instructor cohort evidence, support triage, roster import preview, content
publication workflow and budget administration. Use clear sample-size and
insufficient-evidence states. Separate infrastructure failures from learner
errors. Do not create automatic certification, hiring or misconduct decisions.

Seed only content that passes authoring QA. Implement a public content projection
and build-output check that prevent private tests and solutions being bundled.
Keep the first release target at 24 reviewed challenges while tracking progress
toward all 43 reference equivalents and the 120-item library.
```

## Phase 4: deploy, verify and hand over

```text
Deploy the approved architecture to staging with repeatable CDK infrastructure
and CI. Verify actual region/model availability and account quotas. Run the
200-client save/navigation workload and 200-job submission burst described in
the deployment plan. Test timeouts, cancellation, duplicate delivery, queue
recovery, model outage, budget exhaustion, hidden-feedback leakage and a restore.

Complete a small learner pilot and fix the observed issues. Update the cost model
with measured run duration, billed memory, token use, judge calls and model rates.
Document release, rollback, content promotion, backup restore and incident owners.
Distinguish measured results from targets. Before enabling production spend,
resolve the recorded region, sign-in, budget and assessment-policy decisions.
```

## Content-authoring prompt

```text
Author [PROBLEM_ID] from the planning catalog as an original FDE Academy challenge.
Preserve its skill objective and difficulty. Use the established Northstar or
Harbor scenario where suitable. Read the guidance contract before writing.

Deliver the exact learner brief, allowed artifacts and edits, interface schema,
starter files, visible normal/boundary cases, held-out cases, adversarial cases,
trusted reference solution, evaluator contract, safe feedback categories,
level-appropriate hints, rubric, interview follow-up and runtime manifest.
Explain what each test detects. Include at least one valid alternative solution
where the contract permits multiple approaches. Use deterministic fixtures unless
live generation is needed for the learning objective.

Validate the reference, prove the starter fails the intended requirement, and
show that known faulty mutations are detected. Do not expose expected outputs
inside the candidate environment. Do not claim a semantic threshold is validated
until it has been calibrated against reviewer-labeled cases. Mark the package
review-ready, not published, until the content reviewer approves it.
```

## Milestones and exit gates

| Milestone | Demonstration required before moving on |
|---|---|
| M0: contracts and shell | Requirement map, typed data contracts, visual shell and explicit mock boundaries |
| M1: execution feasibility | A004 isolated run, trusted oracle, cancellation/cleanup and permission tests |
| M2: useful learning slice | Saved draft → visible failure → repair → immutable submission → correct safe feedback |
| M3: guidance and GenAI | Four levels enforced; exact edit checks; calibrated prompt evaluation |
| M4: cohort MVP | Roadmaps, technical screen, manual review, budget controls, 24 approved challenges |
| M5: cohort launch | Pilot, load/security checks, measured cost, rollback and restore evidence |
| M6: content expansion | All 43 equivalents approved, then 60 and 120 total approved challenges |

## Decisions to keep explicit

- `ADR-001`: AWS-first portal versus multi-vendor alternative.
- `ADR-002`: Managed candidate sandbox and trusted grading boundary.
- `ADR-003`: Python-first language/package support and later project environments.
- `ADR-004`: Equal access and separate persona recommendations.
- `ADR-005`: Deterministic versus semantic evaluation and calibration.
- `ADR-006`: Assessment assistance policy and evidence labels.
- `ADR-007`: Region, inference routing, retention and identity provider.
- `ADR-008`: Resource quotas, budget reservation and fair scheduling.

A short decision record contains the context, selected option, evidence, trade-off and revisit trigger. It should not become a substitute for implementing the accepted choice.

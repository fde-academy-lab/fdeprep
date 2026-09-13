# Session prompts

One prompt per cloud session. Paste the prompt into a new session at claude.ai/code with the `fdeprep` environment selected and the `fde-academy-lab/fdeprep` repository attached.

Merge each pull request before starting the next session.

Every prompt below assumes `CLAUDE.md`, `.claude/` and `docs/` are already committed, which is what Session 0 depends on and every later session inherits. `.claude/rules/` loads automatically, so the prompts do not repeat the trust boundaries.

Before pasting a phase prompt, consider running `/grill-me` against it in a local session first. It finds the ambiguity in a spec before a cloud session builds the wrong reading of it, and it costs ten minutes against a phase that costs hours.

---

## Session B: bootstrap (run this first, once)

GitHub's web uploader skips any folder whose name starts with a dot, so
`.claude/` and `.gitignore` are missing from the repository after a browser
upload. This session puts them there. It takes about a minute.

```
Run: bash scripts/bootstrap.sh --with-skills

That script writes .claude/settings.json, .claude/rules/, .claude/skills/ and
.gitignore into the repository. GitHub's web uploader cannot create dot-folders,
which is why they are missing.

Then do four things:

1. Print the tree of .claude/ so I can see what was created.
2. Read every SKILL.md under .claude/skills/vendor/ that the script fetched.
   Give me a one-line summary of each and flag any that run shell commands or
   fetch from the network. Delete any that are irrelevant to a Next.js plus
   Python plus AWS build, and tell me which you deleted and why.
3. Pin the vendored sources: replace MATTPOCOCK_REF and ANTHROPIC_REF in
   scripts/bootstrap.sh with the commit SHAs that were actually fetched, which
   are recorded in each vendor folder's .source file.
4. Confirm .gitignore covers .env, node_modules, cdk.out, __pycache__ and
   audio files.

Commit everything to main directly. This is configuration, not code, so it does
not need a pull request.

Do not build anything else in this session.
```

After this finishes, every later session picks up the rules and skills
automatically on clone.

---

## Session 0: foundations

```
Read CLAUDE.md, .claude/rules/, then docs/00-PRD.md, docs/02-DATA-MODEL.md,
docs/08-DESIGN-SYSTEM.md and the Phase 0 section of docs/06-BUILD-PLAN.md.

docs/source-pack/ is an earlier pack from a different model. Read
docs/09-SOURCE-PACK-RECONCILIATION.md before trusting anything in it. Do not
follow its architecture.

Build Phase 0 only. Do not start Phase 1.

Scaffold the repository:
- Next.js App Router with TypeScript in strict mode, Tailwind, CodeMirror 6.
- Every table in docs/02-DATA-MODEL.md as migrations, including tables that
  later phases use. Pick a migration tool and justify the choice in one line
  in the PR body.
- Auth.js with the GitHub provider. On sign-in, check membership of the
  FDE-Academy-Hub organisation, then look up an active enrolment. Three
  distinct failure states with the exact messages from docs/01-WIREFRAMES.md
  section S1.
- A seed script creating one cohort, the three personas, the thirteen
  competency rows, and the rate limit policy rows from docs/02-DATA-MODEL.md
  section 6.
- The design system from docs/08-DESIGN-SYSTEM.md as real tokens: the colour
  variables, the six-step type scale, self-hosted Inter and JetBrains Mono
  copied from /opt/fonts into the repo, tabular figures enabled on every
  numeric surface, and the motion durations. No font CDN.
- The application shell with navigation and a named empty state on every route.
- GitHub Actions: lint, typecheck, unit tests, and a job that validates
  problem YAML under problems/ once that validator exists.

Start PostgreSQL in the session and prove the migrations and seed run against
it end to end.

Write the acceptance tests from Phase 0 of docs/06-BUILD-PLAN.md before the
implementation, and make them pass.

Do not deploy anything. Do not add AWS credentials. Open a pull request on
branch chore/phase-0-foundations with a body listing what you built, what you
chose and why, and anything in the specs that looked wrong.
```

---

## Session 1: the runner

```
Read CLAUDE.md, .claude/rules/01-trust-boundaries.md, then
docs/03-RUNNER-AND-GRADING.md in full including section 9, then
docs/04-PROBLEM-AUTHORING.md section 3 for the worked example.

Section 9 contains four corrections that supersede anything earlier in that
document. The first one, that hidden means unpublished rather than unreadable,
changes how fixtures are staged. Get it right now; it is not repairable later
without redoing grading.

Build Phase 1 only. No web UI in this session.

Build runner/ as a Lambda container image on Python 3.12:
- harness/: the mock LLM with the full matcher vocabulary, the tool fixture
  library from section 3, the assertion registry from section 2.4, and trace
  capture.
- battery/: the static AST gate, ordered gate execution, result contract
  assembly per section 5, and trace post-processing with the automatic flags
  from section 6.
- A CLI: python -m runner.local <problem.yaml> <solution.py> that prints the
  full result contract. This is how problems get authored, so make its output
  readable.

Build and run the container inside this session with Docker and the Lambda
runtime interface emulator. Prove it works, do not assume it.

Write these tests first:
- Every one of the ten adversarial fixtures triggers its assertion.
- The worked Medium problem runs end to end from the CLI.
- A correct solution passes every gate; a naive one passes public and fails
  at least one hidden test. Write both solutions.
- The same solution run twenty times produces byte-identical gates output.
- Code containing subprocess, socket or eval is rejected at the static gate.
- An infinite loop returns timeout rather than crashing the process.
- A trace over 256KB truncates with a marker and truncated: true.
- No expected output is ever written into the runner working directory. Assert
  it by scanning the staged directory in the test.
- One case, or a bounded batch, is staged per invocation. Never the full
  hidden suite.

The determinism test is the one that matters. If it does not hold, stop and
report rather than proceeding.

Verify the AWS Lambda container image contract against current AWS docs before
writing the Dockerfile, and say in the PR which docs you checked.

Open a pull request on branch feat/phase-1-runner.
```

---

## Session 2: problems and the code workspace

```
Read CLAUDE.md, docs/04-PROBLEM-AUTHORING.md, docs/01-WIREFRAMES.md sections
S3 and S4, and Phase 2 of docs/06-BUILD-PLAN.md.

Build Phase 2 only.

- YAML loader and validator implementing every rule in
  docs/04-PROBLEM-AUTHORING.md section 1, wired into CI over problems/.
- Admin import action writing problem and problem_version rows, with a diff
  preview before publish.
- Problems catalogue, screen S3, with all four filter groups and three sorts.
- Code workspace, screen S4: three resizable panes, CodeMirror editor, Run,
  and the output pane.
- The outbox from docs/03 section 9.2: the submission row, the cap decrement
  and the outbox row are written in one transaction, and a dispatcher publishes
  to the queue. Never write the row and publish separately.
- Runner consumption with the lease and fencing token from section 9.3, and a
  compare-and-set on the terminal verdict.
- Result delivery to the client over server-sent events with polling as
  fallback. Use a local queue shim in the session; the real SQS wiring is
  infrastructure code that a human deploys.

Seed eight problems yourself for testing. Keep them crude; real content comes
in Phase 8 and these are throwaway fixtures under problems/_fixtures/.

Acceptance tests from Phase 2 of the build plan, written first.

Before opening the PR, run the spec-check skill against the diff.

Open a pull request on branch feat/phase-2-workspace.
```

---

## Session 3: the scaffold ladder and caps

```
Read CLAUDE.md, docs/00-PRD.md sections 3.2 and 4, and Phase 3 of
docs/06-BUILD-PLAN.md.

Build Phase 3 only. This phase is the product's differentiator, so build the
policy engine properly rather than scattering difficulty checks.

- One policy module that answers, for a given enrolment and problem: which
  scaffold layers render, whether hints are unlocked, what test visibility
  applies, and how many submits remain. Every component asks this module. No
  component reads difficulty directly. Enforce that with a lint rule if you can.
- Hint reveal with logging, the Hard attempt-note gate at 200 characters, the
  Extreme learner-test gate, and the Extreme confirmation dialog.
- Rolling-window rate limiting against rate_limit_counter, enforced in the API
  route before the queue write.
- The full submit path: battery, scoring per docs/03 section 5, competency
  state transitions per docs/02 section 7.
- The step protocol from docs/03 section 9.4 for the capped live run. The
  learner writes the same run_agent signature in both modes; against the mock
  the callable is a local fixture, and in a live run it marshals through the
  protocol. Learner code never holds a credential.
- Give-up action unlocking L5 and recording the choice.

Write scripts/burst_test.ts that fires 200 concurrent submits and asserts no
counter drift. Run it in this session.

Two tests that must exist and must pass:
- An error verdict leaves the counter unchanged. Force a runner failure to
  prove it.
- An identical resubmission on Extreme is rejected by hash before the cap
  decrements.

Open a pull request on branch feat/phase-3-ladder.
```

---

## Session 4: prompt surgery and the judge

```
Read CLAUDE.md, docs/03-RUNNER-AND-GRADING.md sections 4.2 to 4.4,
docs/04-PROBLEM-AUTHORING.md section 4, and docs/01-WIREFRAMES.md sections
S5 and S6.

Build Phase 4 only.

- judge/ as a separate Lambda with Bedrock permission only and no code
  execution. Judge prompts as files under judge/prompts/, never in the database.
- Static rule engine for prompt_rule, running in the application, since it is
  regex over text and needs no sandbox.
- Prompt workspace, screen S5: original, edited and diff modes, live checklist
  updating on a debounced local evaluation with no network call per keystroke.
- Probe execution: two runs per probe, agreement required, disagreement returns
  error and requeues once without consuming the cap.
- Rubric judge with exemplar anchoring. Parse judge output as JSON against a
  schema and reject non-conforming output rather than coercing it.
- Design workspace, screen S6, and the defence step on Hard and Extreme code
  problems.

Verify the current Bedrock model identifiers and the converse API surface
against AWS documentation before writing the client. Name the model in config,
never inline.

Three tests that must exist:
- A submission leaving a forbidden token in place fails with exactly zero
  model calls. Assert the count.
- Probe content stays hidden until the learner passes.
- A design answer containing an instruction to award full marks scores on
  content. Keep this test permanently.

Open a pull request on branch feat/phase-4-prompt-judge.
```

---

## Session 5: tracks, progress and trace replay

```
Read CLAUDE.md, docs/01-WIREFRAMES.md sections S2, S7 and S9, and Phase 5 of
docs/06-BUILD-PLAN.md.

Build Phase 5 only.

- Three persona tracks with ordered items, and the roadmap screen S2 with
  Next Up drawn from the learner's track.
- Competency scoring on every finished submission with the four states from
  docs/02 section 7. A pass with hints revealed is passed, never clean.
- Progress screen S9 with the heatmap and CSV export.
- Trace replay viewer, screen S7: step navigation, the automatic flags, and
  fixture annotations revealed only after the attempt closes.

Two rules to hold: every problem stays reachable from the catalogue for every
persona, and the heatmap must match a hand-computed result for a seeded account.
Write that hand-computed fixture.

Open a pull request on branch feat/phase-5-progress.
```

---

## Session 6: rehearsal, admin and ops

```
Read CLAUDE.md, docs/01-WIREFRAMES.md sections S8 and S10, and
docs/05-DEPLOY-AND-OPS.md sections 6 and 7.

Build Phase 6 only.

- Rehearsal shell, screen S8: persona-driven problem selection, the timer,
  Extreme rules applied regardless of native difficulty, and the report.
- Admin screens S10: roster with CSV persona upload, problem import,
  submission browser, ops dashboard.
- Degraded mode toggle that disables Submit and leaves Run working. Build this
  even though it looks minor; it converts an outage into an inconvenience.
- Requeue action on a stuck submission, and a counter-clear action with a
  mandatory reason written to audit_log.
- infra/ as an AWS CDK stack in TypeScript covering everything in
  docs/05-DEPLOY-AND-OPS.md: two queues with dead letter queues, two Lambdas
  with separate roles, two S3 buckets with lifecycle rules, a VPC with private
  subnets and no NAT gateway, VPC endpoints for S3 and SQS, one ECR repository,
  and the three CloudWatch alarms.
- .github/workflows/deploy.yml assuming an OIDC role. Do not run it.

Run cdk synth in the session and fix what it reports. Do not run cdk deploy.

Open a pull request on branch feat/phase-6-admin, and include in the body the
exact IAM trust policy a human needs to create for the OIDC role.
```

---

## Session 7a: voice capture and streaming

```
Read CLAUDE.md and docs/07-VOICE-SCREEN.md in full.

Build the capture and transport half of Phase 7 only. No cockpit UI yet.

- Consent screen and the voice_consent gate. No session starts without a row.
- Microphone check: a five second pre-flight that detects a muted or absent
  device and refuses to start the session if it fails.
- Capture pipeline: getUserMedia with echo cancellation and noise suppression,
  an AudioWorklet downsampling to 16kHz mono PCM, frames every 100ms, plus a
  separate MediaRecorder copy for playback.
- The SttAdapter interface exactly as specified in section 7, with an Amazon
  Transcribe streaming implementation behind it.
- The voice session WebSocket endpoint: API Gateway WebSocket API in front of
  a Lambda, as CDK code. The browser gets a short-lived signed session token
  from the application and never holds AWS credentials.
- Schema additions from section 8.

Before writing the adapter, verify the current Amazon Transcribe streaming API
against AWS documentation: the transport options, the event shapes for partial
and final results, and the audio encoding it expects. Say in the PR what you
verified and on what date. Do not write it from memory.

Also verify current API Gateway WebSocket idle and duration limits, and set the
session idle timeout below the platform maximum so an abandoned session cannot
hold a connection open.

Build a bare test page that opens the socket, streams a microphone, and prints
partial and final transcripts to the console. That is the deliverable for this
session. The cockpit comes next.

Open a pull request on branch feat/phase-7a-voice-capture.
```

---

## Session 7b: the cockpit

```
Read CLAUDE.md and docs/07-VOICE-SCREEN.md sections 2, 3, 4 and 5.

Build the guided cockpit, unguided mode and pressure mode. No scoring yet.

Guided mode has exactly five live instruments: the beat track, the pace band,
the territory row, the mic level, and the nudge slot. Nothing else renders
during an answer.

Three rules that are more important than anything else in this session:
- No transcript text appears on screen during an answer, in any mode. Write a
  test that fails if it does.
- No model call happens while the learner is speaking. Live beat lighting runs
  on partial transcripts and cheap normalised substring matching against the
  beat anchors. Assert the model call count is zero during the answer window.
- The nudge slot shows one line at a time, never two, and never within 20
  seconds of the previous line.

Build the nudge engine as a pure function of (elapsed_ms, beat_state,
partial_transcript, last_nudge_at) so it can be unit tested without audio and
replayed later.

Unguided mode is the question, the clock, the mic level and a stop button.
Compute every nudge and every beat transition anyway and store them with
was_shown false, because Session 7c replays them.

Pressure mode: authored follow-ups only, fired at beat boundaries, spoken
through Amazon Polly with the audio cached in S3 per question. Maximum two
interruptions. The main clock pauses during an interruption.

Follow the cockpit visual rules in section 3 exactly, and docs/08-DESIGN-SYSTEM.md
section 9 where it constrains them further. Read both again before you start
styling. The pace band changes colour with no transition, because the change is
the signal.

Build the non-visual equivalent at the same time: beat transitions and nudges
announced through a live region, and the pace band state readable as text. A
cockpit that only works visually is a cockpit half the accessibility floor
fails on.

Open a pull request on branch feat/phase-7b-cockpit.
```

---

## Session 7c: voice scoring and debrief

```
Read CLAUDE.md and docs/07-VOICE-SCREEN.md sections 6, 7 and 9.

Build scoring, the debrief and instrument replay.

- Deterministic structure and pace metrics computed from the transcript
  timeline and the beat results.
- The rubric judge over the final transcript, anchored on the three exemplars,
  reusing the judge Lambda from Phase 4.
- The debrief screen from section 6.
- Instrument replay: play the recorded audio back with the beat track filling,
  the pace band changing, and every stored nudge appearing at its timestamp.
  In unguided mode this is the whole teaching device, so make it good.
- Audio privacy from section 9: 30 day S3 lifecycle, learner-initiated
  deletion that keeps the score, and faculty access to audio only on explicit
  share.

The fairness rule is not optional and not a preference. Delivery metrics, which
are words per minute, filler count and longest pause, appear in the debrief and
nowhere else. They must not reach the score, the competency heatmap, or the CSV
export. Write a test that fails if any delivery field appears in the export.

Add the three voice rate limit scopes to rate_limit_policy.

Open a pull request on branch feat/phase-7c-voice-scoring.
```

---

## Session 8: content

```
Read CLAUDE.md, docs/04-PROBLEM-AUTHORING.md including the authoring checklist
in section 6, and docs/07-VOICE-SCREEN.md section 11.

This session writes content, not application code.

Produce 25 problems in problems/ matching the distribution in docs/00-PRD.md
section 9, and 12 voice questions matching the distribution in docs/07 section
11.

For every code problem:
- Solve it yourself from the stub using runner/local, and commit your solution
  under problems/<slug>/reference_solution.py.
- Write a naive solution that passes the public tests and fails at least one
  hidden test, and commit it under problems/<slug>/naive_solution.py with a
  test asserting it fails.
- Confirm the call budget sits one above a clean solution and at least two
  below the naive one.

For every voice question, write four to six beats, anchors that a real answer
would actually contain, a rubric, and three exemplar transcripts at strong,
adequate and weak.

Run the validator over everything and make CI green.

Stop and ask before inventing content for a track you have no source material
for. A thin problem is worse than a missing one.

Open a pull request on branch content/launch-set.
```

---

## A prompt for when something goes wrong

```
Read CLAUDE.md and the relevant docs/ file for the area in question.

<describe the failure and paste the error>

Diagnose before changing anything. Tell me what is actually broken and what
you would change, and wait for me to agree before editing more than one file.

If the specification in docs/ is what is wrong rather than the code, say so and
propose the spec change.
```

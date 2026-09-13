# FDE Prep: product requirements

Working name is **FDE Prep**. It holds two problem tracks, **GenAI for FDEs** and **Agentic AI for FDEs**. The name lives in one config constant and can be changed without touching anything else.

Audience for this document: the engineer or coding agent building the system. Everywhere below, "you" means that builder.

---

## 1. What this is

A practice and assessment platform for FDE Academy cohorts. A learner opens a problem, reads a brief, writes code or edits a system prompt or writes a design answer, runs it against visible tests, submits it against hidden and hostile tests, and gets back a verdict plus a replayable trace of what their agent actually did.

The platform exists to produce one number the placement side can trust: is this learner ready for an agentic AI tech screen, and where specifically are they weak.

### Non-goals for v1

- No free versus paid tiers. Every problem is visible to every enrolled learner.
- No public sign-up. Access comes from GitHub organisation membership.
- No discussion forum, no content hosting, no video. Those stay on GitHub, which is already the delivery platform.
- No mobile-first layout. The workspace is a three-pane desktop screen and will be usable but not pleasant on a phone.

---

## 2. Users and access

| Role | How they get in | What they can do |
|---|---|---|
| Learner | GitHub OAuth, must be a member of the `FDE-Academy-Hub` organisation and present in the cohort roster | Solve problems, see their own progress, run rehearsals |
| Faculty | Same OAuth, flagged in the roster | Everything a learner can do, plus read any learner's submissions and traces |
| Admin | Same OAuth, flagged in the roster | Author and import problems, manage rosters, set caps, read the ops dashboard |

Offboarding a learner is removing them from the GitHub organisation. There is no second user list to keep in step.

### Personas

Every enrolment carries one persona, set from the baseline diagnostic and changeable by an admin.

| Persona | Roadmap shape |
|---|---|
| Builder | Starts on the Easy tier of the fundamentals track, long runway of guided problems, Extreme problems visible but not on the roadmap until the track is 60 percent complete |
| Navigator | Starts at Medium on fundamentals, roadmap weights toward tool creation, memory and retrieval |
| Accelerator | Starts at Hard, roadmap is mostly Extreme and design-argument problems, fundamentals available as optional revision |

The persona changes the ordered roadmap and the default landing view. It never hides a problem. The Problems screen shows the full catalogue to everyone.

---

## 3. The problem object

A problem is a graded artefact, a scaffold stack, a test battery, and a set of competency tags.

### 3.1 Artefact types

| Type | Learner produces | First grading gate | Second gate | Third gate |
|---|---|---|---|---|
| `code` | A Python module against a stub | Deterministic tests run against a scripted mock LLM | Hidden tests | Adversarial battery |
| `prompt` | An edited system prompt, with required deletions and additions | Static checks: forbidden tokens absent, required clauses present, mandated spans actually removed, length cap respected | Probe battery: fixed user messages run against the edited prompt at temperature 0, each with a programmatic assertion | Rubric judge |
| `design` | A written architecture answer, 200 to 600 words | Structural checks: minimum length, required headings if the brief mandates them | Rubric judge anchored on three graded exemplars | Optional faculty override |
| `voice` | A spoken answer into a microphone under a clock | Deterministic structure and pace metrics from the transcript timeline | Rubric judge over the final transcript | Optional interviewer follow-up in Pressure mode |

The voice type has its own module with its own question format, screens and privacy rules. See `07-VOICE-SCREEN.md`. It shares the platform's scoring philosophy, its rate limit table and its competency tags, and nothing else.

Grading always runs cheapest and most deterministic first. A submission that fails a static check never reaches a model call.

### 3.2 The scaffold ladder

Six layers. Difficulty decides which are on.

| Layer | Content |
|---|---|
| L0 Brief | Scenario, acceptance condition, constraints. Always present. |
| L1 Contract | Function signature, input and output schema, allowed imports, call budget. |
| L2 Stub | Skeleton file with ordered `# TODO` markers that map one to one onto L3 steps. |
| L3 Step checklist | Sub-tasks, each with its own micro-check that turns green independently, so progress is visible before the whole battery passes. |
| L4 Hints | Revealed one at a time. Every reveal is written to the attempt record and shown to faculty. |
| L5 Reference walkthrough | The worked solution with commentary. Unlocked on pass, or on an explicit give-up that is recorded. |

| Difficulty | Layers on | Hint policy | Test visibility | Extra rules |
|---|---|---|---|---|
| Easy | L0, L1, L2, L3 | L4 free and unlimited | Public test names and assertions visible | Acceptance rate shown |
| Medium | L0, L1, L2 | L4 unlocks after one failed run | Public test names visible, hidden count shown | Acceptance rate shown |
| Hard | L0, L1 | L4 unlocks after two failed runs and a written attempt note of at least 200 characters | Hidden count only | Acceptance rate hidden |
| Extreme | L0 only, blank editor | No hints at any point | Nothing. The learner writes their own tests first and those tests are stored. | Timed, one submit per 24 hours, adversarial battery always runs |

The written attempt note on Hard is deliberate friction. It produces text a faculty member can read to see whether the learner is stuck on the concept or on Python.

### 3.3 Competency tags

Every problem carries one to four tags from a fixed vocabulary. Tags roll up into a per-learner heatmap.

```
agent-loop, tool-schema-design, tool-error-handling, state-and-memory,
retrieval, context-assembly, evaluation-design, failure-mode-analysis,
prompt-construction, prompt-hardening, cost-and-latency, system-design,
client-communication
```

Adding a tag is a migration plus a seed row. Do not let authors invent tags inline.

---

## 4. Running and submitting

Two distinct actions, and the distinction drives cost control.

| Action | What it runs | Cost | Cap |
|---|---|---|---|
| **Run** | Public tests only, against the scripted mock LLM | Compute only, no model tokens | 30 per account per hour, soft rate limit with a countdown in the UI |
| **Submit** | Public, hidden and adversarial batteries, against the scripted mock LLM | Compute only | See table below |
| **Live run** | The learner's code against a real model through Bedrock, no assertions, trace only | Model tokens | 10 per account per day, shared across all problems |

### Submit caps

| Difficulty | Submits per problem per day | Rationale |
|---|---|---|
| Easy | Unlimited | Nothing to protect. Iteration is the point. |
| Medium | 10 | Discourages brute-forcing hidden tests by permutation |
| Hard | 5 | Same, harder |
| Extreme | 1 | The attempt is the signal. A second attempt on the same day destroys it. |

Do not cap the number of problems a learner may start or solve per day. Capping throughput punishes the learners who are actually working. Cap the things that cost money (live runs) and the things that leak answers (submits on the hard tiers).

All caps are rows in a `rate_limit_policy` table, editable by an admin without a deploy.

### The 24/7 requirement

The platform is always available. There is no release gate, no scheduled window, no queue that a human has to drain. Every cap resets on a rolling window rather than at a fixed clock hour, so a learner in a different time zone is not disadvantaged.

---

## 5. The mock LLM

The single most important design decision in this build.

Agent problems normally require a language model in the loop, which makes grading non-deterministic, slow and expensive. FDE Prep grades against a **scripted mock LLM**: a fixture that returns pre-written responses according to matching rules, records every call, and never touches a network.

Consequences, all good:

- The same submission always produces the same verdict. There are no flaky tests and no appeals about randomness.
- Grading 200 submissions costs the price of 200 Lambda invocations and zero tokens.
- A problem author can script exact hostile behaviour, which is impossible with a real model.
- Learners still get real-model experience through the capped live-run button, where correctness is not being judged.

The full contract is in `04-RUNNER-AND-GRADING.md`. Build that before building anything else that depends on it.

---

## 6. The adversarial battery

Hidden tests check edge cases. The adversarial battery checks hostility, which is what breaks agents in production and what tech screens probe.

Standard hostile fixtures every author can pull from a library:

| Fixture | What it does |
|---|---|
| `tool_lies` | Tool returns a confident, well-formed, wrong answer |
| `tool_soft_error` | Tool returns HTTP 200 with an error object in the body |
| `malformed_on_nth` | Tool returns invalid JSON on the third call only |
| `injected_instruction` | A tool result contains text instructing the agent to ignore its system prompt |
| `schema_drift` | Tool starts returning an extra field, then a renamed field |
| `slow_then_timeout` | Tool succeeds twice, then never returns |
| `loop_bait` | The scripted model keeps proposing the same tool call, testing whether the loop terminates |
| `budget_squeeze` | The call budget is set one below the naive solution's requirement |

A problem declares which fixtures apply. Each fixture carries its own assertion, usually "terminates", "does not crash", "returns a well-formed result", or "does not follow the injected instruction".

---

## 7. Beyond correctness

### 7.1 Budget scoring

Every run records LLM call count, tool call count and wall time. A solution that passes in four model calls scores above one that passes in fourteen. Budget is reported on every submission and contributes to the problem score on Hard and Extreme.

### 7.2 Trace replay

Every run produces an ordered trace of model calls, tool calls, observations and the final answer. The workspace renders it as a timeline the learner can step through. A pass or fail line teaches nothing about an agent loop; the trace does.

### 7.3 The defence step

On Hard and Extreme code problems, passing the battery unlocks a defence prompt: 120 words on why the design handles a named failure mode. The answer is rubric-judged and recorded. A problem is not marked complete until the defence is submitted.

This exists because learners have access to coding assistants. Assume every learner has one. Grade the things assistants are weak at, which are judgement under a hostile fixture and articulation of a trade-off.

### 7.4 Rehearsal mode

A timed session that draws a set of problems matching the learner's persona and runs them under Extreme rules regardless of their native difficulty: no hints, no test names, no acceptance rates, one submit each. It produces a transcript and a rubric score in the same shape as the real FDE tech screen rubric.

Rehearsals are capped at two per week per learner so the result stays meaningful.

---

## 8. Progress and reporting

### Learner view

- Roadmap position, showing the next three recommended problems for their persona.
- Competency heatmap across the thirteen tags, scored from submission history.
- Attempt history per problem, including hints revealed and budget used.

### Faculty and admin view

- Cohort heatmap, sortable by competency, so a weak column across the cohort becomes a session topic.
- Per-learner drill-down: submissions, traces, hint reveals, attempt notes, defence answers.
- Stuck list: learners with three or more failed submits on the same problem and no successful submit in seven days.
- Live ops: queue depth, runner error rate, live-run token spend for the day.

Export is CSV, since the cohort trackers live in spreadsheets.

---

## 9. Content source

Problems come from the `FDE-Academy-LAB` interview bank and from what candidates report being asked. Generic agent exercises are available anywhere; problems drawn from real FDE screens are the reason to build this rather than buy seats on something existing.

Launch target is 20 to 25 problems that are actually good, weighted as follows.

| Difficulty | Count | Types |
|---|---|---|
| Easy | 8 | 6 code, 2 prompt |
| Medium | 8 | 5 code, 2 prompt, 1 design |
| Hard | 6 | 4 code, 1 prompt, 1 design |
| Extreme | 3 | 2 code, 1 design |

Twenty-five problems with real hidden tests and real adversarial fixtures beat sixty thin ones. The catalogue grows from session material after launch.

---

## 10. Decisions carried into the build

| Decision | Value | Status |
|---|---|---|
| Languages | Python 3.12 only in v1 | Locked |
| Auth | GitHub OAuth with organisation membership check | Locked |
| Live model provider | Amazon Bedrock, model pinned per problem | Locked |
| Multi-cohort | `cohort_id` present on every learner-scoped row from day one | Locked, because retrofitting tenancy later is expensive and adding a column now is not |
| Coding assistants | Assumed available to every learner, and the design compensates rather than polices | Locked |
| Integrated browser | In-page code editor in v1. A real agent-driven browser using AgentCore Browser is a v2 problem family. | Locked for v1 |
| Difficulty labels | Easy, Medium, Hard, Extreme | Locked |
| Problem authoring | YAML files in a Git repository, imported through an admin action | Locked |

---

## 11. Acceptance for v1

The build is done when all of the following are true.

1. A learner in the GitHub organisation can sign in and see a roadmap matching their persona.
2. A code problem at each of the four difficulties renders with the correct scaffold layers on and the correct hint policy enforced.
3. Run returns public test results in under five seconds at the ninety-fifth percentile.
4. Submit runs public, hidden and adversarial batteries and returns a verdict, a budget report and a trace.
5. The same submission submitted twice returns byte-identical test results.
6. A prompt-surgery problem rejects a submission that leaves a forbidden token in place, without making a model call.
7. Rate limits hold under a scripted burst of 200 concurrent submissions.
8. A learner removed from the GitHub organisation cannot sign in on their next session.
9. An admin can import a new problem from YAML and see it live without a deploy.
10. The cohort heatmap renders from real submission data.

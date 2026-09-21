# FDE Prep

A practice and assessment platform for FDE Academy cohorts. A learner opens a problem, writes code or edits a system prompt or writes a design answer or speaks an interview answer under a clock, submits it against tests they cannot see, and gets back a verdict plus a replayable trace of what their agent actually did.

The platform exists to produce one signal the placement side can trust: is this learner ready for an agentic AI tech screen, and where specifically are they weak.

| | |
|---|---|
| **Built** | 14 to 20 September 2026, twenty-four merged pull requests |
| **Size** | 21,103 lines of TypeScript in the web application, 5,248 lines of Python in the runner and judge, 1,083 lines of CDK |
| **Tests** | 710 across four suites, all green: 421 web, 233 Python, 30 infrastructure, 26 voice |
| **Content** | 25 problems and 12 voice questions, each solved by its author before it shipped |
| **State** | Runs end to end on a laptop with `docker compose up`. Not yet deployed anywhere. Section 3 is the deploy. |

---

## Contents

1. [The system](#1-the-system)
2. [Run it on your machine](#2-run-it-on-your-machine)
3. [Deploy it for a beta cohort](#3-deploy-it-for-a-beta-cohort)
   - [Route A: Vercel and managed Postgres](#3a-route-a-vercel-and-managed-postgres)
   - [Route B: one AWS box](#3b-route-b-one-aws-box-no-subscriptions)
4. [Maintain it](#4-maintain-it)
5. [Fix it when it breaks](#5-fix-it-when-it-breaks)
6. [What to use in code](#6-what-to-use-in-code)
7. [How it was built: the PDLC log](#7-how-it-was-built-the-pdlc-log)
8. [Roadmap](#8-roadmap)

---

# 1. The system

## 1.1 The problem it solves

An FDE tech screen asks a candidate to build an agent under time pressure and then defend the design out loud. Cohort training prepares people for the first half and almost nobody for the second. Worse, a training programme that grades its own learners on effort produces a readiness claim that placement teams learn to discount.

FDE Prep separates practice from measurement. Practice is unlimited and free. Measurement is capped, deterministic and recorded, so a learner's readiness number means the same thing in week one and week nine.

## 1.2 The one decision everything else follows from

**Agent problems are graded against a scripted mock model, never a live one.**

A learner writes `run_agent(question, llm, tools)`. At grading time `llm` is not a model. It is a lookup table that matches the prompt against authored rules and returns a pre-written response, recording every call in a trace.

Four consequences, and they shape every other decision in this repository:

| Consequence | What it buys |
|---|---|
| The same submission always produces the same verdict. | There are no appeals about randomness, and a learner who re-submits identical code cannot get a different mark. |
| Grading costs no model tokens. | Two hundred learners can practise all night without anybody watching a bill. |
| Learner code never reaches a model endpoint. | Token spend is bounded by construction rather than by a quota that someone has to monitor. |
| A problem author writes the model's failures. | You can author a tool that returns HTTP 200 with an error in the body, and every learner meets that exact failure. |

Live model runs exist as a separate, capped privilege at ten per learner per day. A live run produces a trace and never produces a pass or a fail, so nobody can farm the model for a verdict.

## 1.3 Architecture in one diagram

```mermaid
graph TD
  L[Learner browser] --> V[Next.js web application]
  V --> G[GitHub OAuth plus org membership check]
  V --> P[(PostgreSQL 16)]
  V -->|outbox, one transaction| Q[Submissions queue]
  Q --> R[Runner Lambda: executes learner code]
  R --> T[S3 traces]
  R --> RQ[Results queue]
  RQ --> W[Result writer]
  W --> P
  V --> J[Judge Lambda: calls models]
  J --> B[Amazon Bedrock]
  V --> S[Voice socket: API Gateway WebSocket]
  S --> TR[Amazon Transcribe]
```

**The two Lambdas never merge, and that is the security model.** The runner executes learner code and holds no Bedrock permission, no database write permission, and no internet route out of its VPC. The judge calls models and never executes learner code. Results travel between them through a queue, so neither one can be talked into doing the other's job.

Everything the browser sends is treated as a claim rather than a fact. A sandbox id, an execution role, a model identifier, a storage path, a difficulty and a cap allowance are all resolved on the server from the enrolment and the problem version. The read-only styling on a prompt-surgery editor is an affordance for the learner, and the real edit-region check runs server-side.

## 1.4 Where it came from

Three lineages, and one thing deliberately not copied.

| Source | What was taken |
|---|---|
| The judge-and-verdict loop familiar from competitive programming sites | The shape of the interaction, which is write, run against visible tests, submit against hidden ones, get a verdict. The grading philosophy is inverted: hidden tests here assert against a scripted model's trace rather than against program output alone. |
| Aircraft instrument panels | The Voice Screen cockpit. A panel is readable because the pilot knows which instrument to look at first, so the cockpit allows exactly five live instruments with one primary, and colour carries state rather than decoration. |
| Instructional scaffolding, the idea that support should fade as competence grows | The six-layer scaffold ladder in section 1.5, where difficulty decides which layers are switched on rather than which problems are visible. |

**Not copied:** no code, markup, stylesheet or problem text comes from any existing interview-practice product. The visual identity is original, and every problem and question in `problems/` and `voice-questions/` was written for this repository.

There is also an earlier build pack in `docs/source-pack/`, prepared by a different model on 14 September 2026. It chose DynamoDB, Cognito and a session-priced sandbox, and all three were replaced. `docs/09-SOURCE-PACK-RECONCILIATION.md` records what it got right (the outbox, the lease, the step protocol, and the observation that hidden does not mean unreadable), what was corrected, and why. Read that file before trusting anything in the source pack.

## 1.5 The four artefact types

Grading always runs cheapest and most deterministic first. A submission that fails a static check never reaches a model call.

| Type | Learner produces | Gate 1 | Gate 2 | Gate 3 |
|---|---|---|---|---|
| `code` | A Python module against a stub. | Deterministic tests against the scripted mock model. | Hidden tests. | Adversarial battery. |
| `prompt` | An edited system prompt with required deletions and additions. | Static checks on forbidden tokens, required clauses and length. | Probe battery at temperature 0, each probe with a programmatic assertion. | Rubric judge. |
| `design` | A written architecture answer of 200 to 600 words. | Structural checks on length and required headings. | Rubric judge anchored on three graded exemplars. | Faculty override (not yet built, see section 8). |
| `voice` | A spoken answer into a microphone under a clock. | Deterministic structure and pace from the transcript timeline. | Rubric judge over the final transcript. | Interviewer follow-up in Pressure mode. |

### The scaffold ladder

Six layers of support. Difficulty decides which are on, and never which problems are visible.

| Layer | Content |
|---|---|
| L0 Brief | The scenario, the acceptance condition and the constraints. Always present. |
| L1 Contract | The function signature, the input and output schema, the allowed imports and the call budget. |
| L2 Stub | A skeleton file with ordered `# TODO` markers that map one to one onto the L3 steps. |
| L3 Step checklist | Sub-tasks, each with a micro-check that turns green on its own, so progress shows before the whole battery passes. |
| L4 Hints | Revealed one at a time. Every reveal is written to the attempt record and shown to faculty. |
| L5 Reference walkthrough | The worked solution with commentary, unlocked on a pass or on a recorded give-up. |

| Difficulty | Layers on | Hints | Test visibility | Extra rules |
|---|---|---|---|---|
| Easy | L0 to L3 | Free and unlimited. | Public test names and assertions are visible. | The acceptance rate is shown. |
| Medium | L0 to L2 | Unlock after one failed run. | Public test names are visible and the hidden count is shown. | The acceptance rate is shown. |
| Hard | L0, L1 | Unlock after two failed runs and a written attempt note of at least 200 characters. | Only the hidden count is shown. | The acceptance rate is hidden. |
| Extreme | L0 only, blank editor | None, at any point. | Nothing. The learner writes their own tests first and those tests are stored. | Timed, one submit per 24 hours, adversarial battery always runs. |

The attempt note on Hard is deliberate friction. It produces text a faculty member can read to see whether a learner is stuck on the concept or stuck on Python.

## 1.6 How an answer is graded: the panel

**Specified in `docs/10-EVALUATION-PANEL.md`. Not yet built.** The three gates in the table above are what exists today, and they become panelist 1 when the panel lands.

Three evaluators run in a fixed order and their findings are consolidated into one verdict and one voice.

```
  submission
      │
      ▼
 ┌──────────────────────────────────────────────────────┐
 │  P1  static and heuristic       always runs          │
 │      no model, no network, milliseconds              │
 │  P2  pretrained models          when the level asks  │
 │      no LLM, offline, CPU                            │
 │  P3  LLM judge                  when the level asks  │
 │      the only network call in the panel              │
 │             │                                        │
 │             ▼                                        │
 │  consolidator  →  one verdict, one score, one voice  │
 └──────────────────────────────────────────────────────┘
```

| Rule | Why |
|---|---|
| P1 always runs, and runs first. | A learner gets feedback even when every model in the system is unreachable. |
| A problem using P2 or P3 must declare P1 checks. Enforced in CI. | The outage fallback is structural rather than something an author remembered. |
| A panelist that cannot run never lowers a score. | The evaluation goes to `partial` and re-runs for free. Infrastructure is the platform's problem. |
| Only deterministic checks produce a terminal failure. | A verdict nobody can reproduce is a verdict nobody can appeal. |
| Disagreement between panelists is reported, never averaged. | Averaging two judges who disagree produces a confident number that hides the one fact worth knowing. |

**Panelist 2 trains nothing.** The repository holds 86 labelled examples, all written by the author and none by a learner, which is far too few to train a grader and exactly enough to produce one that is confidently wrong. So the learning already happened, elsewhere. P2 embeds the answer with a pretrained model and asks which graded answers it sits nearest to. The pool starts as the three authored exemplars on a problem and grows by one row per graded submission, which is how it comes to know a cohort without anybody running a training job.

Three neighbours vote, weighted by how near each one is, because a neighbour at 0.82 is far better evidence than one at 0.31 and counting them equally throws that away. An answer that resembles nothing in the pool gets no band at all: that is not a weak answer, it is an answer this panelist has no evidence about, and saying so is worth more than a confident guess.

**How much evidence it needs rises with the level.** One neighbour is enough on a C2 code problem the battery already graded. From C3 up it needs two, because one neighbour produces a weighted vote of confidence 1.00 by construction, so the split warning cannot fire exactly where the evidence is thinnest. Two is what a fresh three-exemplar pool actually supplies, measured across the 11 authored problems with rubrics; three would silence the panelist rather than restrain it. Below the bar it reports what it saw and withholds the band, and a withheld band never lowers a grade.

Measured and settled: `all-MiniLM-L6-v2` int8, chunked to avoid truncation, at 67ms p95 for a 700-word answer on one core, running in the worker rather than the judge Lambda. `docs/10` section 5 carries the numbers and the reasoning, and `scripts/bench_embeddings.py` re-runs the measurement.

### Complexity is not difficulty

Two axes that answer different questions, kept separate on purpose.

| Axis | Values | Decides |
|---|---|---|
| Difficulty | Easy, Medium, Hard, Extreme | How much support the learner gets, and which caps apply. |
| Complexity | C1 recall, C2 application, C3 synthesis, C4 judgement, C5 open | What shape the answer has, and therefore which panelists can check it. |

A Hard problem can ask a C2 question and an Easy problem can ask a C4 one. Each complexity level is named for the shape of the answer rather than for how the learner feels, because the shape is what decides whether a machine can check it: C1 has one right answer and C5 has none.

### The module boundary

```
        eval/  ──writes──►  evaluation, competency_score
                                 │
                   ┌─────────────┴─────────────┐
                   ▼                           ▼
            progress/  reads              analytics/  reads
            one learner                   many learners
            heatmap, readiness            report card, calibration
```

**One writer, two readers.** A heatmap that disagrees with a report card becomes structurally impossible rather than a bug somebody has to find.

## 1.7 What a learner sees

Ten screens, specified as region maps in `docs/01-WIREFRAMES.md`. Three of them carry the product's identity, so they are reproduced here.

### The code workspace, which is the primary screen

```
+------------------------------------------------------------------+
| < Problems | Recover from tool errors | Medium | Agent Loop       |
|                                    Submits left today: 8          |
+---------------------------+--------------------------------------+
| [Problem][Attempts][Trace]| solution.py            python 3.12    |
|                           | +----------------------------------+  |
| BRIEF                     | | 1  from harness import Harness   |  |
| A tool in your pipeline   | | 2                                |  |
| returns HTTP 200 with an  | | 3  def run_agent(question, llm,  |  |
| error object in the body. | | 4                tools):        |  |
| Your loop must detect it, | | 5      # TODO 1: call the model  |  |
| retry once, then degrade  | | 6      pass                      |  |
| gracefully.               | | 7                                |  |
|                           | +----------------------------------+  |
| CONTRACT                  |                                       |
| run_agent(question: str,  | [ Reset ] [ Run ] [ Live run (7) ]    |
|   llm, tools: dict) -> str|                    [ Submit ]         |
| Budget: 6 model calls     +--------------------------------------+
| Allowed imports: json, re | OUTPUT                                |
|                           | Run complete, 3 of 4 public tests     |
| STEPS                     | pass.                                 |
| [x] 1 Call the model      |                                       |
| [ ] 2 Parse the action    | v terminates_on_final     pass        |
| [ ] 3 Detect soft errors  | v respects_call_budget    pass        |
| [ ] 4 Degrade gracefully  | x detects_soft_error      fail        |
|                           |   expected a retry, saw none          |
| HINTS         [ reveal 1 ]|                                       |
+---------------------------+--------------------------------------+
```

Difficulty changes what renders in the left pane rather than which components exist. On Extreme the left pane holds the brief, a countdown and a panel demanding the learner's own tests before Submit will enable.

### The Voice Screen cockpit

```
+--------------------------------------------------------------+
|  Explain how you guarantee an agent loop terminates    4:45   |
+--------------------------------------------------------------+
|                                                              |
|   [====|====|====|====|====]                                 |
|    b1   b2   b3   b4   b5                                    |
|    ok   ok   NOW  --   --                                    |
|                                                              |
|            +-------------------------+                       |
|            |   ON BUDGET    0:38     |                       |
|            +-------------------------+                       |
|                                                              |
|   territory   step budget · degrade · fallback · escalate    |
|                                                              |
|   ................ [ mic level ] ................            |
|                                                              |
|   > Say what happens when the budget runs out.               |
|                                                              |
|                                    [ Stop and debrief ]      |
+--------------------------------------------------------------+
```

Five live instruments and nothing else. The beat track is primary and everything else is peripheral. The pace band reads `ON BUDGET`, then `STRETCHING` past 130 percent of the beat's seconds, then `OVERRUN` past 175 percent. Territory terms brighten when the learner says them, which makes them landmarks rather than answers. The nudge slot carries one line at a time, at most nine words, with a twenty-second floor between nudges.

**No transcript renders while a learner is speaking.** This is the strictest rule in the module and the one most likely to get built wrong by default, because a learner who can see their words reads them instead of thinking. Filler words get no live nudge either, since counting "um" at someone mid-sentence makes the rest of the answer worse. Both go in the debrief.

### Progress, which is the readiness signal

```
+------------------------------------------------------------------+
| COMPETENCY HEATMAP                                                |
|                     Easy   Medium   Hard   Extreme                |
| agent-loop          [##]   [##]     [# ]   [  ]                   |
| tool-schema-design  [##]   [# ]     [  ]   [  ]                   |
| tool-error-handling [# ]   [  ]     [  ]   [  ]                   |
+------------------------------------------------------------------+
| ATTEMPT HISTORY                                     [ export csv ]|
| date | problem | verdict | submits | hints | budget | defence      |
+------------------------------------------------------------------+
```

Every cell holds one of four states: not attempted, attempted without a pass, passed, and passed with no hints and within budget. **Only the fourth state counts toward readiness.** A learner who passed a Hard problem after revealing three hints and burning double the call budget has learned something real and has not yet demonstrated readiness, and the heatmap says so without anybody having to write it down.

## 1.8 What it can do today

Everything below runs on a laptop with PostgreSQL and no cloud account.

| Capability | Where |
|---|---|
| Sign in with GitHub, checked against organisation membership and an active enrolment. | `/signin` |
| Browse 25 problems filtered by track, difficulty, type and status. | `/problems` |
| Solve code problems in CodeMirror with the scaffold ladder applied by difficulty. | `/problems/[slug]` |
| Run against public tests, submit against the full battery, watch the verdict arrive over SSE. | Same screen |
| Edit a system prompt against static checks, a probe battery and a rubric judge. | Same screen, prompt problems |
| Write a design argument graded against three exemplars. | Same screen, design problems |
| Grade any written answer against the nearest graded answers to it, with no model call and no network. | The worker, on every design, prompt and voice submission |
| Replay the trace of what the agent actually called, step by step. | `/traces/[id]` |
| Answer a spoken interview question in guided, unguided or pressure mode. | `/voice/session` |
| Read a voice debrief with beat timings, pace, filler counts and a rubric score. | `/voice/sessions/[id]` |
| Sit a timed rehearsal under Extreme rules and get a report. | `/rehearsal` |
| See the competency heatmap and export attempt history as CSV. | `/progress` |
| Administer the roster, bulk-change personas from a CSV, read submissions, requeue a stuck one, and flip degraded mode. | `/admin/*` |
| Work a faculty queue of the answers the panel argued about, seeing which panelist said what and recording what you concluded. | `/admin/disagreements` |
| Correct a grade the panel got wrong, which moves the learner's verdict, their score and their competency heatmap, and tells the learner it moved. | Same screen, on a row marked disputed |
| Grade a written answer against rules that need no model: restating the brief, arguing no trade, a long answer in one block, a code answer at double its call budget. | The worker, inside panelist 1 |

Content authored and validated in CI:

| | Count | Breakdown |
|---|---|---|
| Problems | 25 | 17 code, 5 prompt, 3 design. By difficulty: 8 Easy, 8 Medium, 6 Hard, 3 Extreme. By complexity: 17 C2, 5 C3, 3 C4. |
| Voice questions | 12 | Across five tracks: agent loop (3), client communication (3), evaluation design (2), system design (2), tool schema design (2). Budgets run 125 to 155 seconds. |

Every code problem ships with a reference solution that passes and a naive solution that provably fails a hidden test. CI runs both, so a problem that a lazy answer would pass cannot merge.

## 1.9 What it cannot do

Read this section before promising anything to a cohort.

### Never run against the real service

Four integrations are written, unit-tested against recorded fixtures, and have never made a live call. Each one is a first-call risk.

| Integration | State | What could go wrong on first contact |
|---|---|---|
| Bedrock rubric judge | Code complete, 253 Python tests green, `JUDGE_LIVE=1` never run. | A model id, a region, an inference profile prefix or the thinking-mode combination is wrong, and every design and prompt submission errors. |
| Amazon Transcribe streaming | Adapter written against the documented API, exercised only through the scripted adapter. | The live stream shape differs and the cockpit shows a dead microphone. |
| Amazon Polly | Pressure-mode follow-up audio. Never synthesised. | Follow-ups arrive as silence. |
| S3 audio storage | Written, never exercised against a real bucket. | Voice sessions finish and the audio is unreachable. |

**Spend one attempt on each before a learner does.** Section 3, step 7 says how.

### Built to the specification and not yet beyond it

| Gap | Effect |
|---|---|
| The baseline diagnostic that sets a learner's persona does not exist. An admin sets the persona by hand or by CSV. | Personas work. Nothing assigns them automatically. |
| Nothing validates panelist 2 against a human grader. | Its band has never been checked against one on a single answer. The override exists so a wrong band can be fixed, and `analytics/` can now count how often the panel is overruled, which is the measurement that would settle it. |
| The Voice Screen has no question picker. A learner gets the first published question, or the one named in `?q=<slug>`. | Twelve questions are reachable by URL and one is reachable by clicking. |
| `/admin/import` reads `problems/` from disk at request time, so it works locally and cannot work on Vercel. | Publishing content on a deployment is `npm run import:content`, run by an operator. Section 4 covers it. |
| There is no mobile layout. | Explicitly a non-goal for v1 in `docs/00`. The three-pane workspace is usable and unpleasant on a phone. |

### Operationally unproven

| Drill | Why it matters |
|---|---|
| The database restore has never been run. | A restore procedure that has never been run is not a restore procedure. |
| The 200-concurrent-submission burst test has never run against a deployment. `npm run burst` exists and has only run locally. | Peak load is roughly 30 concurrent submissions in the hour after a session ends, and that number is a projection rather than a measurement. |
| There is one operator, and that operator also writes the curriculum. | The failure mode is a Tuesday evening where grading stops, 180 learners are blocked, and the one person who understands the queue is teaching. Section 4 names the two cheap controls. |

---

# 2. Run it on your machine

Twenty minutes from clone to a working product, with no cloud account and no credit card.

## 2.1 The fastest way, one command

Docker, and nothing else installed.

```bash
git clone https://github.com/fde-academy-lab/fdeprep.git
cd fdeprep
docker compose up
```

Open <http://localhost:3000>. Four services come up in order: Postgres, then a one-shot `init` that installs dependencies, migrates, imports the content and fetches panelist 2's embedding model, then the web application and the worker. Expect `published 25 problems and 12 voice questions.` in the `init` log on a first run.

The model fetch is the one step allowed to fail. On a laptop with no network the stack still comes up: the worker carries `EVAL_DEGRADED_PANELISTS=pretrained`, so it starts without panelist 2 and says so in its log rather than refusing. Outside the demo the refusal is the point, and section 3 step 5 covers it.

You are signed in as a development learner with admin rights, because the stack sets `AUTH_DEV_LEARNER=1`. That switch is refused when `NODE_ENV` is production and refused when `GITHUB_CLIENT_ID` is set, so it cannot follow you into a deployment. **This route is for seeing the product and demonstrating it, never for putting in front of learners.**

| Command | What it does |
|---|---|
| `docker compose up` | Starts everything. The first run takes a few minutes while dependencies install. |
| `docker compose down` | Stops everything and keeps the database. |
| `docker compose down -v` | Stops everything and deletes the database, so the next `up` starts clean. |
| `docker compose logs -f worker` | Watches grading. If a submission never resolves, look here first. |

The repository is bind-mounted, so an edit on your machine is live in the container. `node_modules` and `.venv` live in named volumes instead, because a dependency tree built on macOS fails the moment it is mounted into Linux.

## 2.2 What you need

| Requirement | Version | Check with |
|---|---|---|
| Node.js | 22 or newer | `node --version` |
| Python | 3.12 | `python3 --version` |
| PostgreSQL | 16 | `psql --version` |
| Git | Any recent version | `git --version` |

## 2.3 Six commands, and an optional seventh

```bash
git clone https://github.com/fde-academy-lab/fdeprep.git
cd fdeprep

# 1. Python, for the runner and the judge
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

# 2. Node, for the web application
cd web && npm ci

# 3. A database
createdb fdeprep
export DATABASE_URL="postgres://localhost/fdeprep"

# 4. Schema
npm run migrate

# 5. Content: 25 problems and 12 voice questions
npm run import:content

# 6. The application
AUTH_DEV_LEARNER=1 npm run dev
```

Open <http://localhost:3000>.

```bash
# 7. Panelist 2's embedding model, 46MB, verified by checksum
python scripts/fetch_embedding_model.py
```

The worker refuses to start without it, because the published catalogue holds 8 problems that require panelist 2 and grading those without it drops most of the evidence behind every band. It says so at boot and names both ways out:

```
The pretrained panelist cannot run here: model_missing. 8 of 25 published
problems require it, and grading them without it would quietly drop most of
the evidence behind every band.
  Fix it:          python scripts/fetch_embedding_model.py
  Or accept it:    EVAL_DEGRADED_PANELISTS=pretrained
```

`EVAL_DEGRADED_PANELISTS=pretrained` starts anyway and prints what you gave up. Use it for a demo or a box that only serves code problems; those evaluations carry `medium` confidence rather than `high` until the panelist runs. The script pins a model revision and verifies a SHA-256 before it writes, so a model that changed underneath you is a failure rather than a silent change to every band the panel assigns.

`AUTH_DEV_LEARNER=1` creates one development learner with the admin role, so every screen opens without a GitHub application. The switch refuses to work whenever `GITHUB_CLIENT_ID` is set and refuses outright when `NODE_ENV` is production, so it cannot follow you into a deployment.

## 2.4 The second terminal, which is not optional

Nothing grades until a worker drains the queue. A submission with no worker sits in `queued` forever, and the learner watches a spinner.

```bash
cd web && DATABASE_URL="postgres://localhost/fdeprep" npm run worker
```

One process runs the whole pipeline: it dispatches queued submissions, runs the battery as a Python subprocess, calls the judge, writes results, and reaps expired leases. Pass `--once` for a single pass, which is what CI uses.

## 2.5 The Voice Screen, which needs a third and a fourth

The voice socket is API Gateway in the cloud and a plain `ws` server on a developer machine. Both run the same session code.

```bash
# terminal 3: the socket
cd voice && VOICE_STT=scripted VOICE_TOKEN_SECRET=pick-anything npm run dev

# terminal 4: scoring, which fills in the debrief
cd web && npm run scorevoice
```

Then restart the web application with the socket wired in:

```bash
cd web
VOICE_TOKEN_SECRET=pick-anything VOICE_SOCKET_URL=ws://localhost:8787 \
  AUTH_DEV_LEARNER=1 npm run dev
```

Accept at `/voice/consent`, then answer one at `/voice/session?mode=guided`.

`VOICE_STT=scripted` produces placeholder words driven by how loud you are, which makes the whole pipeline visible with no AWS credential. The two `VOICE_TOKEN_SECRET` values have to match, because one end signs the session token and the other verifies it.

## 2.6 Demonstrating it to a room

A five-minute path that shows the product's actual argument rather than its screens.

| Step | Screen | The point to make out loud |
|---|---|---|
| 1 | `/problems`, open an Easy code problem | The ladder is visible: brief, contract, stub, step checklist, free hints. |
| 2 | Write a deliberately wrong loop and press **Run** | Three of four public tests pass, and the failing one names what it expected. |
| 3 | Press **Submit** | Hidden and adversarial tests run. The adversarial fixture is reported by name with the assertion that failed and never with its script. |
| 4 | Open the **Trace** tab | Here is what the agent actually called, in order, with the call budget. This is the thing a tech screen asks about and a pass or fail cannot show. |
| 5 | Open an Extreme problem | Blank editor, a countdown, one submit per day, and a panel demanding the learner's own tests before Submit enables. |
| 6 | `/voice/session?mode=guided` | Answer for thirty seconds and stop. The beat track moved, no transcript appeared, and the debrief has beat timings, pace and filler counts. |
| 7 | `/progress` | Four cell states, and only the fourth counts. This is the number placement gets. |

## 2.7 Run the tests

```bash
cd web   && npm test              # 459 tests
cd ../   && python -m pytest -q   # 253 tests, 3 skipped without the embedding model
cd voice && npm test              # 26 tests
cd infra && npm test              # 30 tests
```

The three skips are the tests that read the real MiniLM weights. A skipped test is honest; a test that quietly passes without the thing it claims to test is not.

---

# 3. Deploy it for a beta cohort

**Nothing in this repository deploys itself.** No agent, no script and no CI job runs `cdk deploy`, `aws lambda update-function-code` or `vercel deploy`. A human runs every deploy, and that is a standing rule in `CLAUDE.md` rather than an accident.

## Two routes, and how to pick

There is no Vercel lock-in anywhere in this codebase: no `@vercel/*` package, no `VERCEL_*` variable, no platform-specific API. A production build serves fine under plain `next start`, so any box that runs Node can host it.

| | Route A: Vercel and managed Postgres | Route B: one AWS box |
|---|---|---|
| What you sign up for | Vercel Pro and a Neon or Supabase project. | Nothing. It all sits in an AWS account you already have. |
| Time to first screen | About thirty minutes. | About an hour. |
| Who patches the server | Nobody, since there is no server. | You do. |
| Rollback | One click in the Vercel dashboard. | `git checkout` the previous commit and rebuild. |
| Suits | A beta with students, and anything you want to stop thinking about. | Your own testing, a demo to a company, a pilot with people you know by name. |

Route B has a security limit that decides it for a real cohort. The last part of this section says exactly what that limit is, and skipping it would be the expensive kind of mistake.

---

# 3A. Route A: Vercel and managed Postgres

Steps 1 to 5 put a working product in front of students. Steps 6 and 7 are the ones people skip and then regret.

## Read this before you pick a free tier

**Vercel's Hobby plan cannot host this.** Its fair use guidelines say Hobby teams are "restricted to non-commercial personal use only", and it defines commercial usage as any deployment "used for the purpose of financial gain of anyone involved in any part of the production of the project, including a paid employee or consultant writing the code". A practice platform for a paid academy's students is commercial under that definition, whether or not the platform itself charges anybody. Deploying on Hobby risks the account being paused mid-cohort.

**Vercel Pro is the plan this needs.** Listed at $20 per month for the team, with additional developer seats at $20 each and unlimited viewer seats. Verified against <https://vercel.com/pricing> and <https://vercel.com/docs/limits/fair-use-guidelines> on 19 September 2026. Re-check both before committing budget, since these change.

## What a beta costs and what it needs

| Piece | Service | Beta cost | Needed for |
|---|---|---|---|
| Web application | Vercel Pro | $20 per month for the team. Hobby is not an option, for the reason above. | Everything. |
| Database | Neon or Supabase, managed PostgreSQL 16 | Neon's Free plan gives 0.5 GB of storage and 100 compute-unit hours per project per month, and Neon positions it for prototypes and small teams rather than production. Nothing in its terms forbids commercial use. Start there and watch storage. | Everything. |
| Worker | Any box that can run Node, including a small VM or your own laptop for a first beta. | Cents, or nothing. | Grading. Without it no submission ever resolves. |
| Runner and judge Lambdas | AWS | Near zero at this volume, since Lambda has no idle cost. | Deterministic grading at scale, and the rubric judge. |
| Bedrock | AWS | Token spend on prompt, design and voice grading only. Code problems cost nothing. | The rubric judge. |
| Voice socket, Transcribe, Polly, S3 | AWS | Per-minute on Transcribe, per-character on Polly. | The Voice Screen with a real microphone. |

Neon's free computes scale to zero after five minutes of inactivity, so the first learner of the morning waits through a cold start. That is an acceptable beta trade and a bad cohort-day trade.

**A first beta can skip AWS entirely.** Deploy the web application, the database and the worker, and run code problems only. The worker executes the battery as a local Python subprocess when `RUNNER_ENDPOINT` is unset, so 17 of the 25 problems grade with no AWS account at all. Add AWS when you want the rubric judge and the Voice Screen.

## Step 1: the database

1. Create a project at <https://neon.com> or <https://supabase.com>. Either works. Pick the region closest to your learners.
2. Copy the connection string. It looks like `postgres://user:password@host/dbname?sslmode=require`.
3. Keep it somewhere safe. It is a credential, so it never goes in the repository.

## Step 2: the GitHub OAuth application

1. Go to <https://github.com/settings/developers>, then **New OAuth App**.
2. Fill it in:

   | Field | Value |
   |---|---|
   | Application name | FDE Prep |
   | Homepage URL | Your Vercel URL, which you will get in step 3. Put a placeholder now and correct it after. |
   | Authorization callback URL | `https://your-app.vercel.app/api/auth/callback` |

3. The callback URL must match exactly, including the scheme and any port. A mismatch is the single most common sign-in failure.
4. Generate a client secret and copy both values.

## Step 3: Vercel

1. Put the team on the **Pro** plan first, for the licensing reason above. Doing this before the first deploy avoids moving a live project later.
2. Go to <https://vercel.com/new> and import `fde-academy-lab/fdeprep`.
3. **Set the root directory to `web`.** The repository root is not a Next.js project, so a deploy without this fails at build.
4. Add these environment variables:

   | Variable | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | From step 1. | |
   | `AUTH_SECRET` | `openssl rand -base64 32` | Signs the session cookie. Changing it signs everybody out. |
   | `GITHUB_CLIENT_ID` | From step 2. | |
   | `GITHUB_CLIENT_SECRET` | From step 2. | A secret. Environment only, never the repository. |
   | `GITHUB_ORG` | Your organisation login. | Optional. Defaults to `FDE-Academy-Hub`. |

5. Deploy. Copy the URL Vercel gives you back into the OAuth application's Homepage and callback fields from step 2.

**Do not set `AUTH_DEV_LEARNER` here.** It is refused when `NODE_ENV` is production and refused when `GITHUB_CLIENT_ID` is set, so it cannot do damage, and setting it means somebody misread this document.

## Step 4: schema and content

Both commands run from your machine against the production database. Nothing in the deployed application can do this, by design.

```bash
cd web
export DATABASE_URL="<the production connection string>"
npm run migrate
npm run import:content
```

Expect `published 25 problems and 12 voice questions`. Re-run it after every content change; it updates in place and duplicates nothing.

## Step 5: the worker

Nothing grades without it. One process, one environment variable.

```bash
cd web
DATABASE_URL="<production>" npm run worker
```

For a first beta, a `systemd` service or a `tmux` session on a small VM is enough. Anything that restarts it on exit will do. Confirm it is alive by submitting once and watching the verdict arrive.

The worker is also where panelist 2 runs, so run `python scripts/fetch_embedding_model.py` on the same host if you want written answers banded against the nearest graded answers to them. Three variables tune it, and all three have working defaults:

| Variable | Default | What it does |
|---|---|---|
| `RUNNER_PYTHON` | `.venv/bin/python`, then `python3` | The interpreter the worker spawns for the test battery and for the encoder. Set it explicitly when neither resolves. |
| `FDEPREP_EMBED_MODEL_DIR` | `.models/minilm` | Where the encoder looks for the weights. Point it at a shared read-only path when several workers share a host. |
| `EMBED_TIMEOUT_MS` | `20000` | How long the worker waits for an encode before killing it. A hung encoder becomes an unavailable panelist rather than a stuck queue. |
| `EVAL_DEGRADED_PANELISTS` | unset | Panelists this worker starts without, comma separated. Without it the worker refuses to start when its catalogue requires one it cannot run. A name that is not a panelist is rejected rather than ignored, so a typo does not read as "everything is fine". |

## Step 6: the roster, before students arrive

1. Invite every learner to the GitHub organisation. Sign-in failures on day one are almost always somebody who never accepted the invitation.
2. Create the cohort row and an active enrolment per learner.
3. Set each enrolment's persona. Use the CSV upload on `/admin/roster`, which takes a login column and a persona column and writes every change to the audit log.
4. Sign in as a learner yourself and open one problem at each difficulty. Four minutes, and it catches everything.

## Step 7: AWS, when you want the judge and the Voice Screen

The infrastructure is written as CDK in `infra/` and the image build is `.github/workflows/deploy.yml`. **A human runs the deploy.**

1. Bootstrap CDK in your account and region, then `npx cdk deploy` from `infra/`. Read `docs/05-DEPLOY-AND-OPS.md` section 4 first.
2. Set `JUDGE_MODEL_ID` to a Bedrock inference profile id, for example `us.anthropic.claude-opus-5`. A bare model id is refused at start-up with an error that says why, because on-demand throughput on `bedrock-runtime` needs a geo or global profile prefix. Verified against AWS documentation on 14 September 2026.
3. Point the web application at the deployed functions with `JUDGE_ENDPOINT` and `RUNNER_ENDPOINT`.
4. For voice, set `VOICE_SOCKET_URL` to the API Gateway WebSocket URL and `VOICE_TOKEN_SECRET` to the same value on both ends.
5. **Spend one attempt on each live integration yourself.** Submit one design problem to prove the judge, and answer one voice question with a real microphone to prove Transcribe. These four integrations have never made a live call, so the first learner to touch them is otherwise your first test.

## Step 8: the two things people skip

| Control | Effort | What it prevents |
|---|---|---|
| A second person with console access, the runbook in `docs/05` section 7, and one practice drill. | An afternoon. | A Tuesday evening with 180 blocked learners and the only operator teaching. |
| An AWS Budgets alarm on the Bedrock line at 50 and 80 percent. | Ten minutes. | A prompt-injection attempt or an authoring mistake quietly costing real money. |

Also worth doing once: restore the database to a new branch and verify against a known submission id. A restore that has never been run is not a restore.

---

# 3B. Route B: one AWS box, no subscriptions

Everything on a single EC2 instance: the web application, the database, the worker and the grader. Nothing outside your own AWS account.

```
        ssh -L 3000:localhost:3000
your laptop  ─────────────────────────►  one EC2 instance
                                          ├── next start        the web application
                                          ├── npm run worker    grading
                                          ├── postgresql-16     or RDS, if you prefer
                                          └── python3.12        runs the test battery
                                                    │
                                                    ▼  IAM instance role
                                               Bedrock, for the rubric judge
```

## B1: launch the instance

| Setting | Value | Why |
|---|---|---|
| AMI | Ubuntu 24.04 LTS | It ships Python 3.12 and PostgreSQL 16, which is what this needs and saves you two repositories. |
| Type | t3.medium | `next build` is the memory-hungry step. This is a judgement rather than a measurement: 2 GB is where Next builds start failing, so if you want t3.small, add 2 GB of swap before you build. |
| Disk | 20 GB gp3 | Dependencies, the build and Postgres. |
| Security group | **SSH from your own address, and nothing else open.** | You reach the application through an SSH tunnel, which means no public port, no DNS record and no certificate to manage. |

## B2: install the toolchain

```bash
sudo apt update
sudo apt install -y python3.12-venv postgresql-16 git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Node comes from NodeSource, documented at <https://github.com/nodesource/distributions>.

## B3: clone, build and load

```bash
git clone https://github.com/fde-academy-lab/fdeprep.git && cd fdeprep
python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements-dev.txt

sudo -u postgres createuser -s ubuntu && createdb fdeprep
export DATABASE_URL="postgres:///fdeprep"

cd web && npm ci
npm run migrate
npm run import:content
NODE_ENV=production npx next build
```

## B4: sign in, and the trap that costs an hour

`AUTH_DEV_LEARNER=1` behaves differently depending on how you start the server, and the difference is deliberate:

| How you start it | The switch | What happens |
|---|---|---|
| `npm run dev` | Honoured | One development learner with the admin role, so every screen opens. |
| `next start` with `NODE_ENV=production` | **Refused** | `/problems` answers 307 to `/signin?next=%2Fproblems`. |

The guard is working. On a box, use real GitHub OAuth.

**The tunnel makes this simple.** Your browser reaches the application at `http://localhost:3000`, so the OAuth callback is `http://localhost:3000/api/auth/callback` and GitHub accepts it with no DNS and no certificate. Register the application at <https://github.com/settings/developers>, then on the instance:

```bash
export NODE_ENV=production
export AUTH_SECRET="$(openssl rand -base64 32)"
export GITHUB_CLIENT_ID=...  GITHUB_CLIENT_SECRET=...  GITHUB_ORG=your-org

npx next start        # terminal one
npm run worker        # terminal two, or nothing ever grades
```

From your laptop, `ssh -L 3000:localhost:3000 ubuntu@<instance-ip>`, then open <http://localhost:3000>.

Once it works, put both processes under `systemd` so they survive a reboot.

## B5: the judge, when you want prompt and design problems graded

Attach an instance role carrying `bedrock:InvokeModel`, then set `JUDGE_MODEL_ID` to an inference profile id such as `us.anthropic.claude-opus-5`, and `JUDGE_REGION` to your region. A bare model id is refused at start-up with a message naming the fix.

Three prerequisites catch people out, all from the [Bedrock model access documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) read on 19 September 2026:

1. Anthropic models need a **First Time Use form** submitted once per account, or once at the organisation's management account. It asks for your intended use and a website URL, and a GitHub profile is acceptable if you have no company site.
2. The account needs a **valid payment method** configured for AWS Marketplace. A spare account with no card attached fails here.
3. The role needs `aws-marketplace:Subscribe` on the first invocation. Bedrock starts the subscription in the background and it can take up to fifteen minutes, during which calls return `AccessDeniedException`, so a first failure is not automatically a bug.

**Skip all of that for a first look.** The 17 code problems grade with no AWS service at all, because the worker runs the battery as a local Python subprocess whenever `RUNNER_ENDPOINT` is unset. You get the whole loop of write, run, submit, verdict and trace without a single Bedrock call.

## Where one box stops being acceptable

The runner executes Python written by learners. The design puts that in a Lambda inside a VPC with no internet route, no Bedrock permission and no database write permission, and `infra/` already builds exactly that.

On one box, learner code runs as a subprocess on the same machine as your database credentials and your Bedrock role. Two layers of defence sit in the Python itself: a static AST gate, and a runtime import blocker covering `subprocess`, `socket`, `os`, `ctypes`, `pickle` and about fifteen others. Those stop the obvious attacks. **Neither is a kernel boundary**, and somebody who can submit arbitrary Python is a real adversary rather than a hypothetical one.

| Who is using it | One box | The Lambda split |
|---|---|---|
| You, testing it yourself | Fine. | Unnecessary. |
| A demo to your own company | Fine. | Unnecessary. |
| A pilot with people you know by name | Acceptable. | Better. |
| A beta with students | **No.** | Yes. |

Moving up is additive rather than a rebuild. Run `npx cdk deploy` from `infra/`, which creates the VPC, both Lambdas with separate roles, three queues with dead-letter queues and the S3 buckets, then set `RUNNER_ENDPOINT` and `JUDGE_ENDPOINT` on the box. Same instance, same commands, one boundary added.

---

# 4. Maintain it

## 4.1 The weekly rhythm

| Cadence | Task | How |
|---|---|---|
| Daily during a cohort | Glance at `/admin/ops` for queue depth, runner error rate and live-run token spend. | One screen, ten seconds. |
| After every content change | Republish. | `npm run import:content` against the production database. |
| Weekly | Read the attempt notes on Hard problems. | They are the cheapest signal you have about whether a cohort is stuck on the concept or on Python. |
| Per cohort | Run the roster checklist in section 3 step 6. | |

## 4.2 Changing content

A problem or a voice question is a YAML file. Nothing about content lives in the database except a published copy.

```bash
# edit problems/agent-loop/recover-from-soft-tool-errors.yaml
cd web
npm run validate:problems      # the same gate CI runs
npm run import:content         # publish
```

CI validates every problem and every voice question on every pull request, so a broken file cannot reach the import step. That is deliberate: a problem should never fail at run time in front of a learner who is already solving it.

To author a new one, use the `problem-authoring` or `voice-question-authoring` skill in `.claude/skills/`. Both enforce the rules that matter, including the requirement that a naive solution provably fails a hidden test.

## 4.3 Changing the schema

```bash
# add web/migrations/014_whatever.sql
cd web && npm run migrate
```

**Every migration stays backward compatible for one release.** Add a column before anything writes to it, and drop it a release later. Rollback has to remain possible, and the web application rolls back from the Vercel dashboard in one click while the database does not.

## 4.4 Changing grading

Judge prompts are files in `judge/prompts/`, versioned as `rubric.v1.md` and so on. They are never in the database, so changing how a cohort is graded is a code review rather than a form submission. There is currently no mechanism for re-grading past submissions against a new prompt version, which matters if you change one mid-cohort.

## 4.5 What degraded mode is for

`/admin/ops` has a toggle that disables Submit and leaves Run working. Learners keep practising against public tests while grading is down, and nobody loses an attempt. Flip it the moment grading looks unhealthy rather than after you have diagnosed why. It turns an outage into an inconvenience.

---

# 5. Fix it when it breaks

## 5.1 The three questions, in order

1. **Is the worker running?** Most reported faults are a dead worker. Check the process, then check `/admin/ops` for queue depth.
2. **Is it one learner or all of them?** One learner is usually enrolment or organisation membership. All learners is the queue, the database or a deploy.
3. **Did anything deploy in the last hour?** Vercel rolls back in one click from its dashboard.

## 5.2 Symptoms and causes

| Symptom | Likely cause | Fix |
|---|---|---|
| A submission sits in `queued` forever. | No worker is draining the queue, or the message was lost. | Start the worker. If the queue depth is zero and the row is over five minutes old, use the requeue action on `/admin/submissions`. It writes a fresh message and does not consume the learner's cap. |
| Every page redirects to `/signin`. | No session cookie, or `AUTH_SECRET` changed and signed everybody out. | Sign in again. If it loops, the callback URL does not match the OAuth application exactly. |
| "Your GitHub account is not in the FDE Academy organisation yet." | They were invited and never accepted. | The programme manager re-invites. |
| "Your account is not enrolled in an active cohort." | Organisation membership is fine and there is no enrolment row. | The cohort lead adds one. |
| A learner lost an Extreme attempt to a platform fault. | This should be impossible, since an `error` verdict does not consume an allowance and that is tested rather than assumed. | If it happened anyway, clear the counter row for that learner, scope and window on `/admin/ops`, and log the reason. The audit trail is the point. |
| Every design or prompt submission returns `error`. | The judge cannot reach Bedrock, or `JUDGE_MODEL_ID` is a bare model id. | Check the Lambda logs. A bare id fails at start-up with a message that names the fix. |
| The voice cockpit shows a dead microphone. | The socket is unreachable, or the two `VOICE_TOKEN_SECRET` values differ. | Check both ends. `/voice/lab` is a bare transport check that prints transcripts to the browser console and shows them nowhere. |
| The Voice Screen serves the wrong question. | Content was never imported, so it fell back to the `docs/07` fixture. | `npm run import:content`. The fixture's prompt mentions spinning forever in production, which is how you recognise it. |
| `next build` fails on `/_global-error` with a null `useContext`. | `NODE_ENV` is set to `development` in the shell. | `NODE_ENV=production npx next build`. |
| A local run cannot find Python. | The runner subprocess resolves `.venv` then `python3`. | Set `RUNNER_PYTHON` to an explicit interpreter path. |
| The worker exits immediately with "cannot run here: model_missing". | The published catalogue requires panelist 2 and this host has no embedding model. This is the check working, not a fault. | `python scripts/fetch_embedding_model.py` on that host, or `EVAL_DEGRADED_PANELISTS=pretrained` to start without it and accept `medium` confidence on the affected problems. |
| Every design evaluation is `partial` and the re-run queue only grows. | Panelist 2's encoder is failing rather than absent: a timeout, a crash or a response that did not parse. An absent model is `skipped` and leaves the evaluation `complete`, so a growing backlog means something is breaking. | Read the `reason` on the `pretrained` panelist in the evaluation record. `timeout` means the host is too slow or `EMBED_TIMEOUT_MS` is too tight; `encode_failed` and `exit_1` carry the Python error. Reproduce with `echo '{"texts":["an answer"]}' \| python -m embed.cli`, which prints the reason and exits zero. |
| Design answers get a band from the judge and never from the nearest graded answers. | This host has no embedding model, which is a supported state rather than a fault. | `python scripts/fetch_embedding_model.py`. Until then panelist 2 reports `model_missing` and skips, and the panel runs two-strong. |

## 5.3 Reading a failure properly

The trace is the diagnostic, not the verdict. Open `/traces/[id]` and read what the agent actually called. A submission that failed `respects_call_budget` and a submission that failed `detects_soft_error` look identical in the verdict column and nothing alike in the trace.

For a runner fault, the result contract in `docs/03-RUNNER-AND-GRADING.md` is the only thing the front end renders from. If a verdict looks wrong on screen, check the contract before checking the component: presentation logic is deliberately kept out of grading, so a rendering bug and a grading bug live in different files.

## 5.4 When it is the platform's fault

An `error` verdict never consumes a learner's allowance. This is the rule that keeps the whole readiness signal trustworthy, because a learner who loses their one daily Extreme attempt to an infrastructure fault stops believing every score they are given afterwards. It is enforced in code and covered by tests. If you ever find a path that consumes an allowance on an error, that is a release-blocking bug rather than a nuisance.

---

# 6. What to use in code

## 6.1 The stack, and why each piece

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 16.3.5 App Router, React 19, TypeScript strict with `noUncheckedIndexedAccess` | Preview deployment per branch, no server to patch, one-click rollback. |
| Styling | Tailwind 4 | No component library, so the visual identity stays original. |
| Editor | CodeMirror 6 with Python mode | No model-backed autocomplete and no inline assistant, because the learner is the one being assessed. |
| Database | PostgreSQL 16 through `pg` | The workload is joins and aggregates: heatmaps, rollups, stuck lists, CSV exports. |
| Runner and judge | Python 3.12 on Lambda container images | Zero idle cost, a hard kill on hang, one invocation per submission with no shared state. |
| Voice socket | TypeScript on API Gateway WebSocket, plain `ws` locally | The same session code runs in both, so local development exercises the real thing. |
| Tests | vitest for TypeScript, pytest for Python | 685 tests total. |

**Do not introduce a third language.** TypeScript for the web, Python for the runner and judge, and that is the whole list.

**Do not add a dependency that duplicates one already present.** Say what you would add and why before adding it. The current dependency list is short on purpose.

## 6.2 The rules that are enforced rather than remembered

| Rule | How it is enforced |
|---|---|
| No component reads `difficulty` directly. Everything asks the policy module. | A custom ESLint rule, `fdeprep/no-direct-difficulty`, set to error in `web/eslint.config.js`. |
| Problem YAML is validated in CI, not at import. | `npm run validate:problems` and `npm run validate:voice` run on every pull request. |
| Every new assertion type ships with a fixture, a unit test and a validator entry. | Review, plus the validator failing on an unknown type. |
| A terminal verdict is committed with a compare-and-set on the runner's lease. | Tested. It stops a late or duplicated runner overwriting a fresh result. |
| The submission row, the cap decrement and the queue message are written in one transaction through an outbox. | Tested. Without it a submission exists with no message and hangs forever. |

## 6.3 The boundaries that are not negotiable

These live in `.claude/rules/01-trust-boundaries.md`. Weakening one is a change to the security model and needs saying out loud in the pull request.

- **The two Lambdas never merge.** If a task seems to need learner code to call a model, use the step protocol in `docs/03` section 9.4 instead.
- **Hidden means unpublished, not unreadable.** Learner code can read anything staged into its own process, so stage one case or a bounded batch per invocation and never stage an expected output next to an input. Comparison happens in the trusted evaluator, outside the sandbox.
- **The harness objects are staged, so their internals are closed.** The static gate rejects a private attribute read on anything other than `self`, `cls` or `super()`. `llm._script` would turn a problem into a lookup and `llm._trace` would let a solution write tool calls that never happened.
- **Never trust learner-reported anything.** Pass counts, timings and result summaries printed by learner code are strings rather than facts.
- **Client input is never authoritative.** A sandbox id, an execution role, a model identifier, a storage path, a difficulty and a cap allowance are all resolved server-side.
- **Prompt injection reaches the judge as data.** Learner text is wrapped in delimiters and labelled as data, and judge output is parsed as JSON against a schema and rejected when it does not conform. A design answer asking for full marks scores on content.

## 6.4 Writing style, for anything a person reads

From `.claude/rules/02-writing.md`, and it applies to learner copy, error messages, empty states and pull request bodies.

- **Error messages name the next action.** "Submission failed" is not a message. "The runner timed out after 10 seconds. Your attempt was not counted. Try again." is a message.
- **Never use "beginner".** Never call the baseline diagnostic a test. Difficulty labels are Easy, Medium, Hard and Extreme, and nothing else.
- **Pick one noun and repeat it.** Repetition reads as rigour and variation reads as uncertainty.
- Avoid the AI register: delve, leverage as a verb, robust, seamless, holistic, unlock, elevate, crucial, pivotal, myriad, plethora.

## 6.5 Verify before you assert

Library APIs, AWS service surfaces and model identifiers change. Check current documentation before writing against one and say in the pull request which version you verified against. This bites hardest on the Amazon Transcribe streaming API, API Gateway WebSocket limits, the Bedrock model identifiers and the Lambda container image contract.

If documentation and memory disagree, documentation wins. `judge/config.py` carries its verification date and the two documentation URLs it was checked against, which is the pattern to copy.

## 6.6 The working style that produced this

Write the acceptance tests first, before the implementation. Tests written after the code test the code that exists rather than the behaviour required. Every phase in section 7 started that way, and it is the single practice most responsible for the suite being green rather than green-ish.

---

# 7. How it was built: the PDLC log

Six days, twenty pull requests, one agent pair-building against a specification written before any code. What follows is the honest version, including the parts that went wrong.

## 7.1 The shape

```
Specification (10 documents, 2,843 lines)
        |
        v
Phase 0  Foundations: rules, skills, CI, environment
        |
        v
Phase 1  The runner, alone           PR #1
Phase 2  Problems and the workspace  PR #2
Phase 3  The ladder, caps, steps     PR #3
Phase 4  Prompt surgery and judge    PR #4
Phase 5  Tracks, progress, traces    PR #6
Phase 6  Rehearsal, admin, ops, CDK  PR #7
Phase 7  Voice Screen (a, b, c)      PR #8, #9, #10
Phase 8  Content: 25 + 12            PR #11
        |
        v
Corrections found by reading         PR #5, #12, #13
Corrections found by measuring       PR #14, #15, #16
Corrections found by RUNNING IT      PR #17, #18, #19, #20
```

The last row is the interesting one and section 7.4 is about it.

## 7.2 Specification first, and what that cost

Ten numbered documents were written before any code: the product contract, the wireframes, the data model, the runner and grading contract, the problem authoring schema, deploy and ops, the build plan, the Voice Screen, the design system, and a reconciliation of an earlier build pack from a different model.

The rule was that the specification is authoritative and a disagreement gets raised rather than silently resolved. That produced three pull requests whose entire content was correcting a specification:

| PR | What was wrong |
|---|---|
| #5 | `docs/03` specified a seed and a `top_p` that the judge's own thinking mode makes illegal to send together. |
| #12 | The static gate let learner code read a private attribute on a staged harness object, which turns a problem into a lookup. |
| #13 | `docs/04` item 5 disagreed with the worked example in the same document. |

**The cost of specification-first is that you write 2,843 lines before you learn anything from running code.** The benefit showed up in phase 7, where the Voice Screen's hardest rule (no transcript while speaking) was written down before anybody built a cockpit, so it never had to be undone.

## 7.3 Tests before implementation, every phase

Every phase in `docs/06-BUILD-PLAN.md` opens with "write the acceptance tests first". That held for all nine.

It caught things that would have been invisible otherwise. The burst test in phase 3 exists because the acceptance criteria demanded 200 concurrent submissions before the submit path was written, so the outbox and the lease were designed against that number rather than retrofitted to it.

It also produced one honest failure worth recording. In PR #20 a test asserting that a removed beat is dropped from the database failed, because removing a beat takes a question to three and the validator refuses fewer than four. The test was wrong and the validator was right, so the test now renames a beat instead. A test that fails because the system is correct is a good day.

## 7.4 The four things only running it could find

Phases 1 to 8 produced a system that passed 685 tests and had never been used. Then someone asked to see it running, and four faults surfaced in a single afternoon. Each one would have broken the beta on day one.

| # | What was wrong | How it was found | Fixed in |
|---|---|---|---|
| 1 | **There was no authentication at all.** Every visitor resolved to the first enrolment row, which had been created with the admin role. Two learners were one person, and every learner was an administrator. | Opening the application in a browser and noticing nobody was asked who they were. | PR #17 |
| 2 | **Two documented npm scripts pointed at files that never existed.** `dispatch` and `resultwriter` were in `package.json` and in the setup document. Nothing drained the queue. | Trying to grade a submission. | PR #18 |
| 3 | **`/admin/import` cannot work on a deployment.** It reads `problems/` from disk at request time. A production build traced 176 files for that route and zero problem YAML, and the documented fix is refused: Next rejects an `outputFileTracingIncludes` glob with a `../` prefix, and `problems/` sits above `web/`. | Building for production and reading the route's own trace manifest. | PR #20 |
| 4 | **The twelve voice questions were loaded nowhere.** They were authored in phase 8, validated in CI, and had no importer. `/voice/session` was hardcoded to the `docs/07` worked example. | Trying to demonstrate the Voice Screen. | PR #20 |

**The lesson, stated plainly: a green test suite is evidence that the code does what the tests say, and no evidence at all that the product works.** Fault 1 had 396 passing tests around it. Fault 4 had a validator, a CI job and twelve carefully authored files, and not one line of code that read them.

## 7.5 Measuring instead of assuming

Three pull requests came from measurement, and the method is worth keeping.

**PR #14: the voice budgets were a third too generous.** Every voice question's seconds-per-beat had been written from an assumed speaking rate. Reading exemplars aloud and timing them put the real rate near 138 words per minute, so every budget dropped by a third.

**PR #15: a validator rule to stop it recurring.** A beat's share of the clock should be near its share of the words. The rule allows a 2.5-times band in either direction, which is loose on purpose: it catches an authoring mistake and does not argue with a deliberate pause.

**PR #16: rebalancing what the rule caught.** Six questions had beats whose seconds and words disagreed badly, including one where a 15-second beat carried the argument.

One mistake in that sequence is worth recording, because it nearly shipped. The first method for splitting a transcript across beats cut at anchor positions, which structurally over-credits the first beat and starves the last. It manufactured a clean "beat one is always too tight" pattern that was an artefact of the measurement rather than a fact about the content. **Re-measuring with a different method and reporting only what both methods agreed on** is what caught it. A measurement that confirms your hypothesis suspiciously neatly deserves a second method before it deserves a pull request.

## 7.6 One process failure

During PR #17 a `git checkout -B` against `origin/main` discarded an unpushed commit holding the queue worker. The recovery was a force-push, which was blocked, so the worker went out as a separate pull request (#18) and #17 was retitled.

Recorded here because the fix is procedural rather than clever: check whether a branch holds unmerged commits before resetting it, which is one `git log origin/main..branch` away.

A second one, from the same day: PR #17 shipped a proxy that blocked `AUTH_DEV_LEARNER=1`, breaking the documented local workflow. The verification for #17 covered signed-out and signed-in and skipped the path in between. It was found by trying to run the import on a machine with no GitHub application, and fixed in PR #19 with a regression test.

## 7.7 What the specification got right

Worth naming, because six days of building tested it hard.

| Decision | Held up because |
|---|---|
| Deterministic grading against a scripted mock model. | It removed an entire category of problem: no appeals about randomness, no token bill that scales with practice, no flaky verdicts. |
| The outbox between the database write and the queue publish. | It is the reason a submission cannot exist without a message, which is the failure the source pack warned about. |
| Hidden means unpublished rather than unreadable. | It is a subtle point that is easy to get wrong and expensive to discover late, and it was written down before any fixture was staged. |
| One policy module, with an ESLint rule enforcing it. | Difficulty behaviour changed four times during the build and every change was one file. |
| Judge prompts as files rather than database rows. | Changing how a cohort is graded stayed a code review throughout. |

---

# 8. Roadmap

Three horizons. Everything in short term is a known gap with a known fix, and nothing in it is speculative.

## 8.1 Short term: before a beta cohort touches it

| Item | Effort | Why it is first |
|---|---|---|
| Prove the Bedrock judge with one live submission. | An hour. | Four integrations have never made a live call. The first learner to touch one is otherwise your first test. |
| Prove Transcribe, Polly and S3 audio with one real voice session. | An hour. | Same reason. A dead microphone in a timed interview is the worst possible place to discover an adapter bug. |
| Run the database restore drill once. | A morning. | A restore that has never been run is not a restore. |
| Brief a second operator and run one practice drill. | An afternoon. | One operator who also writes the curriculum is the single largest operational risk in this build. |
| Set the AWS Budgets alarm on the Bedrock line at 50 and 80 percent. | Ten minutes. | It is the only thing standing between an authoring mistake and a real bill. |
| Run the 200-concurrent burst test against staging. | An hour. | Peak load is a projection. `npm run burst` exists and has only run locally. |
| Add a question picker to the Voice Screen. | Half a day. | Twelve questions are reachable by URL and one by clicking, which is not a product. |
| Validate `no_tradeoff_language` against spoken answers. | A day. | The rule is narrowed to design because four of twelve authored voice exemplars carry no written trade marker and are still plainly arguments. Widening the list until they stop firing would fit it to twelve examples; deciding what a spoken trade looks like needs more transcripts than exist. |
| Build the second model C5 asks for, or drop C5 from the demand table. | Two days either way. | `secondModel` is in the policy table and nowhere else in the codebase, so no problem can honestly declare C5. A level nothing can use is a level that misleads the next author. |
| Fetch the embedding model on every worker host that grades written answers. | Ten minutes per host. | Without it panelist 2 correctly reports that the host does not have it and the panel runs two-strong, which is a quiet halving of the evidence behind a band. `analytics/` reports the rate, so watch it rather than assuming. |

## 8.2 Mid term: during the first cohort

| Item | What it fixes |
|---|---|
| A baseline diagnostic that sets a learner's persona. | Personas work today and nothing assigns them. An admin sets them by hand or by CSV, which does not scale past one cohort. |
| No problem authors a `constraints` list yet. | `names_no_constraint` is in the registry, validated and tested, and stays silent on all 25 problems because it has nothing to compare against. An author turns it on by writing the list. |
| Re-grading past submissions against a new judge prompt version. | There is no mechanism today, which means changing a prompt mid-cohort leaves two populations graded differently with nothing recording that. |
| A replacement for `/admin/import` that works on a deployment. | Content publishing is an operator command today. That is correct and it is also a person who has to be awake. |
| Build `analytics/`: cohort views, the stuck list, problem calibration and panel health. | Specified in `docs/11`. The heatmap answers "is this learner ready". Nobody can currently answer "which topic did this cohort fail" without SQL. |
| Build the report card as a dated, hashed snapshot. | Specified in `docs/11` section 3. The heatmap is live and a placement team needs a document that does not change after they read it. |
| Move the `competency_score` write into `eval/` and make `progress/` a pure reader. | Specified in `docs/12` section 3. Additive and backward compatible for one release, per the standing rule. |
| Compute the readiness signal, with its four counts and its three bands. | Specified in `docs/12` section 2. The platform has always implied one number and never produced it. |
| More content, driven by what the cohort actually fails. | 25 problems is a launch set rather than a catalogue. `docs/source-pack/05-problem-catalog.json` holds topic material. Do not treat a count as a goal. |

## 8.3 Long term: what a second version would be

| Item | The argument for it |
|---|---|
| The browser problem family, where a learner's agent drives a real browser to fill a form or extract data. | This is the one case where a richer sandbox earns its cost, and `docs/09` names AgentCore Browser as the tool. The `RunnerAdapter` seam already exists to make this reversible. |
| A placement-facing export rather than a CSV. | The platform's whole purpose is a signal the placement side trusts. Today that signal leaves as a CSV, which means somebody re-interprets it every time. |
| Multi-cohort and multi-track at once. | The schema supports cohorts and tracks. Nothing in the interface assumes more than one of either, and the first time two cohorts run concurrently that will show. |
| Peer review on design answers. | A rubric judge scores a design argument against exemplars. A second learner reading it is a different signal and a cheaper one. |
| A mobile reading view, without the workspace. | The three-pane workspace stays desktop. Reading a brief, checking progress and reviewing a debrief on a phone are all reasonable and none of them need an editor. |

## 8.4 What should stay deliberately unbuilt

Named because a roadmap that only grows is a roadmap nobody trusts.

- **Free and paid tiers.** Every problem is visible to every enrolled learner, and adding a tier adds a reason to argue about access instead of about answers.
- **A discussion forum.** GitHub is already the delivery platform and already has one.
- **Live model grading as the default path.** It produces non-deterministic verdicts, appeals nobody can answer, and a bill that scales with practice. The capped live run exists for exploration and produces no verdict, which is the right shape.
- **A mobile workspace.** A three-pane editor on a phone is a worse version of a thing that already works on a laptop.

---

## Where everything lives

| Path | What it is |
|---|---|
| `web/` | The Next.js application, 17 pages and 24 API routes. |
| `runner/` | The Python battery, harness and static gate. Executes learner code and reaches nothing else. |
| `judge/` | The Bedrock judge, with its prompts as versioned files. |
| `voice/` | The voice session socket, its STT adapters and the session protocol. |
| `infra/` | CDK for the Lambdas, the queues, the buckets and the WebSocket. |
| `docker-compose.yml` | The one-command local stack: Postgres, content import, the application and the worker. |
| `problems/` | 25 problems as YAML, plus fixtures under `_fixtures/` that never publish. |
| `voice-questions/` | 12 questions as YAML across five tracks. |
| `docs/` | The specification, which is authoritative. Thirteen numbered documents. |
| `.claude/rules/` | Trust boundaries and writing rules, loaded into every session. |
| `SETUP.md` | Every field value and every link for the build environment. |
| `CLAUDE.md` | The standing rules, the stack, and what not to do. |

When `CLAUDE.md` and a specification document disagree, the specification wins, and the disagreement gets said out loud rather than resolved silently.

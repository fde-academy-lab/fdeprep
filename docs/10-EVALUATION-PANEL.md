# FDE Prep: the evaluation panel

Audience for this document: the engineer or coding agent building the system. Everywhere below, "you" means that builder.

This specifies `eval/`, the module that turns a submission into a graded evaluation. It is the only writer of the `evaluation` record. `progress/` and `analytics/` read that record and never recompute a grade.

Read `03-RUNNER-AND-GRADING.md` first. This document extends its pipeline and does not replace it. Where the two disagree, `03` wins on execution and this document wins on grading structure.

---

## 1. What this module is

A panel of three evaluators, run in a fixed order, whose findings are consolidated into one verdict and one piece of feedback.

```
  submission
      │
      ▼
 ┌─────────────────────────────────────────────────────┐
 │  P1  static and heuristic      always runs          │
 │      no model, no network, milliseconds             │
 │           │                                         │
 │           ▼                                         │
 │  P2  pretrained models         when the level asks  │
 │      no LLM, offline, CPU                           │
 │           │                                         │
 │           ▼                                         │
 │  P3  LLM judge                 when the level asks  │
 │      Bedrock, the only network call in the panel    │
 │           │                                         │
 │           ▼                                         │
 │  consolidator  →  one verdict, one score, one voice │
 └─────────────────────────────────────────────────────┘
      │
      ▼
  evaluation record
```

Three properties hold at every level, and each one is tested rather than assumed.

| Property | Why it exists |
|---|---|
| P1 always runs, and runs first. | A learner gets feedback even when every model in the system is down. |
| A panelist that cannot run never lowers a score. | Infrastructure is the platform's problem. The evaluation goes to `partial` and re-runs for free. |
| Only P1 can produce a terminal failure on a deterministic ground. | A failed hidden test is a fact. A model's opinion is not, and a verdict nobody can reproduce is a verdict nobody can appeal. |

## 2. What this module is not

It does not execute learner code. The runner does that, in its own Lambda, under the trust boundary in `03` section 7. The panel reads the runner's output and never runs anything a learner wrote.

It does not decide difficulty, caps or scaffolding. The policy module owns those and this module asks it.

It does not render. The result contract in `03` section 5 stays the only thing the front end reads from, and section 10 below says how the evaluation record maps onto it.

---

## 3. Complexity, which is not difficulty

Two axes, deliberately separate, because they answer different questions.

| Axis | Owns | Values | Decides |
|---|---|---|---|
| **Difficulty** | The policy module, `lib/policy/tiers.ts` | Easy, Medium, Hard, Extreme | How much support the learner gets, which caps apply, what the UI hides. |
| **Complexity** | This module | C1 to C5 | What shape the answer has, and therefore which panelists can check it. |

They are orthogonal. A Hard problem can ask a C2 question, and an Easy problem can ask a C4 one. Conflating them was the mistake worth avoiding: a learner on their first week can be asked to argue a trade-off, and an experienced learner can be asked to recall an exact contract.

### The five levels

Each level is named for the shape of the answer rather than for how the learner feels, because the shape is what decides whether a machine can check it.

| Level | Name | The answer is | A panelist can check it by |
|---|---|---|---|
| **C1** | recall | One fact, one line, one exact value. | Exact comparison. There is a right answer and it is short. |
| **C2** | application | A known technique applied to a stated case. | Running it. The case is fixed, so the output is fixed. |
| **C3** | synthesis | Two or more ideas combined. Several answers are correct. | Structural similarity to correct shapes, and the absence of known-wrong ones. |
| **C4** | judgement | A trade-off argued under constraints. No single right answer. | Whether the constraints were engaged and the trade named. |
| **C5** | open | An underspecified problem where the framing is the work. | Almost nothing deterministic. The framing itself is the artefact. |

For an author holding the earlier vocabulary: C1 is very easy, C2 easy, C3 intermediate, C4 hard, C5 the one that has no clean answer.

### Which panelists a level demands

| Level | P1 static | P2 pretrained | P3 LLM |
|---|---|---|---|
| C1 | Required, and sufficient on its own. | Not run. | Not run. |
| C2 | Required. | Optional, author's choice. | Not run. |
| C3 | Required. | Required. | Optional, author's choice. |
| C4 | Required. | Required. | Required. |
| C5 | Required. | Required. | Required, with a second model for disagreement. |

**P2 and P3 always imply P1.** This is a validator rule, checked in CI, not a convention somebody remembers. A problem declaring P3 with no P1 checks fails the import.

The rule exists because of outages. When Bedrock is unreachable, a C4 problem still has two panelists. When the embedding model fails to load, it still has one. A learner who submits during an incident gets thinner feedback and never gets silence.

---

## 4. Panelist 1: static and heuristic

No model, no network, no training. It runs in single-digit milliseconds and it is the panelist that can say a submission is wrong and be believed.

| Artefact | What P1 checks |
|---|---|
| `code` | The static gate from `03` section 7, then the public, hidden and adversarial batteries, then budget and trace flags. All of this exists today. |
| `prompt` | Forbidden tokens absent, required clauses present, mandated spans removed, length cap respected, probe assertions. Exists today as the `prompt_rule` engine. |
| `design` | Word range, required headings, and the heuristic checks below. |
| `voice` | Structure and pace from the transcript timeline, which are already deterministic. |

### The heuristic layer

P1 is not only exact matching. A heuristic is a rule an author writes that needs no model and encodes something a reviewer would notice in two seconds.

| Heuristic | Fires when | Artefact |
|---|---|---|
| `names_no_constraint` | A design answer never mentions any term from the brief's constraint list. | design |
| `no_tradeoff_language` | A C4 answer contains no comparative construction at all, which means no trade was argued. | design, voice |
| `single_paragraph` | A 400-word answer with no structure, which reads as a stream rather than an argument. | design |
| `restates_the_brief` | Over 60 percent token overlap with the brief itself. | design, prompt |
| `budget_ignored` | A code answer whose call count exceeds the declared budget by more than double. | code |

Heuristics produce findings and never produce a terminal fail on their own, because a heuristic is a strong hint and not a fact. A heuristic that fires on a reference solution is a bug in the heuristic, and CI runs every heuristic against every reference solution to catch exactly that.

---

## 5. Panelist 2: pretrained models, no training run

The design constraint that shaped this section: **there is no training data.** The repository holds 25 reference solutions, 25 naive solutions and 36 voice exemplars. All 86 were written by the author. Zero were written by a learner.

Training a grader on 86 author-written examples produces a model that has learned how the author writes a wrong answer. Learners fail differently, and the model would be confidently wrong in front of a cohort, which is the one failure mode this platform cannot afford.

So P2 trains nothing. It uses models whose training already happened, on corpora nobody here has to build, and applies them to the graded exemplars that already exist.

| Artefact | What P2 does | What it produces |
|---|---|---|
| `design` | Embeds the answer, finds its nearest neighbours among the graded exemplars, assigns a band by weighted vote. | A band and a distance. The highest-value case, because it is a defensible band with no model call. |
| `prompt` | Embeds the edited prompt against the original and against the reference edit. | Two distances. Catches "deleted everything" and "changed one word" without reasoning about either. |
| `code` | AST shape and control-flow features, compared against the reference and the naive solutions. | A structural similarity score. Catches a solution that is textually novel and structurally the same wrong loop. |
| `voice` | Embeds the transcript against the three exemplars, per beat. | Content coverage per beat, which the deterministic pace metrics cannot see. |

### It improves without a training run

Every graded submission is embedded and added to the index with its final band. The nearest-neighbour pool starts as 3 author-written exemplars per problem and becomes hundreds of real learner answers with real grades.

That is a system that learns from your cohort without anybody running a training job, and without the overfitting risk that made the trained version unbuildable. The quality of P2 on a given problem is a function of how many graded answers that problem has, which is a number `analytics/` reports.

### The model, measured

Measured on 20 September 2026 with `scripts/bench_embeddings.py`, against this repository's own nine graded design exemplars. Re-run it when a model, a runtime version or a Lambda price changes.

| Candidate | Licence | Params | Dims | Documented limit |
|---|---|---|---|---|
| `sentence-transformers/all-MiniLM-L6-v2` | Apache-2.0 | 22.7M | 384 | 256 tokens |
| `BAAI/bge-small-en-v1.5` | MIT | 33.4M | 384 | 512 tokens |

Both licences permit this use. Both ship an ONNX export. MiniLM also ships files pre-quantised per instruction set, which matters more than it sounds.

Latency, one intra-op thread on an AVX-512 Xeon, embedding an answer at the problems' own 700-word ceiling, twenty runs:

| Variant | Model | Load | One pass (truncates) | Chunked (complete) |
|---|---|---|---|---|
| MiniLM int8, avx2 | 23.0 MB | 200 ms | 43.6 ms p95 | 147.0 ms p95 |
| **MiniLM int8, avx512-vnni** | **23.0 MB** | **191 ms** | 20.6 ms p95 | **67.0 ms p95** |
| MiniLM fp32 | 90.4 MB | 614 ms | 38.4 ms p95 | 127.0 ms p95 |
| bge-small fp32 | 133.1 MB | 794 ms | 169.9 ms p95 | 280.4 ms p95 |

The runtime adds 120 MB: ONNX Runtime 67.9, numpy 40.7, tokenizers 11.6. With two model variants that is about 190 MB of image, against Lambda's 10 GB limit. Image size was never the constraint.

### Two traps that would have shipped silently

**MiniLM's `tokenizer.json` truncates at 128 tokens by default.** Not the 256 its model card documents, and not anything the caller asked for. Loaded as shipped, it returns exactly 128 tokens for a 117-word answer and for a 700-word one. A P2 built without calling `no_truncation()` would embed the first hundred words of every answer and band the rest on nothing. The benchmark prints a warning when it detects this, and any P2 implementation sets truncation explicitly rather than inheriting it.

**Half the real answers exceed MiniLM's documented limit anyway.** Measured at 1.19 tokens per word: five of ten test inputs pass 256 tokens, and an answer at the 700-word ceiling is 880. A design argument puts its trade-off in the back half, so truncation does not lose detail, it loses the thing being graded.

Chunking is the fix. Split on paragraphs, embed each, mean-pool. It costs four inferences on a long answer and the numbers above already include that cost.

### The decision: MiniLM int8, chunked, and not in the judge

**Model:** `all-MiniLM-L6-v2`, int8, chunked. At 67 ms p95 for a complete 700-word answer it is four times faster than bge-small chunked, on a model file 5.8 times smaller, and it loses nothing to truncation.

Ship both quantised variants, 46 MB together, and select on CPU flags at start-up. The avx512-vnni file is twice as fast as the avx2 one on hardware that supports it and Lambda's fleet is mixed, so the avx2 file is the fallback rather than the default.

**Where it runs: the worker, not the judge Lambda.** The judge stays at 512 MB with no embedding model in it.

AWS documents that Lambda allocates CPU in proportion to memory and that "at 1,769 MB, a function has the equivalent of one vCPU", verified on 20 September 2026. The judge's 512 MB is therefore 0.29 of a vCPU, so a single-core measurement multiplies by 3.46:

| Where | P2 on a 700-word answer |
|---|---|
| This benchmark, one core | 67 ms p95 |
| Judge Lambda at 512 MB | about 232 ms p95 |
| A Lambda at 1,769 MB | about 67 ms p95 |

Raising memory looks free, because cost is GB-seconds and both settings come to 0.119 GB-seconds for the same work. The reason not to do it is the judge's other job: **P3 spends its time waiting on Bedrock, and waiting is not CPU-bound.** Raising the judge to 1,769 MB would multiply the cost of every second it spends waiting on a model by 3.46, to buy speed for work that is a fraction of its duration. One memory setting cannot serve a CPU-bound workload and a network-bound one.

So P2 runs in the worker, invoked as a Python subprocess exactly as the test battery already is through `RUNNER_PYTHON`. No new language, no new pattern, and the 191 ms model load happens in a long-lived process rather than on every cold start.

P2 makes no network call. That is the whole point of it, since a panelist that needs the network cannot be the fallback for a panelist that needs the network.

---

## 6. Panelist 3: the LLM judge

This is the judge that exists today, in `judge/`, with its prompts as versioned files in `judge/prompts/`. The panel adds three things to it.

| Addition | What it does |
|---|---|
| A panelist envelope | The judge returns findings tagged with its own identity, rather than a bare score, so the consolidator can attribute them. |
| A second model on C5 | Two models answer independently. Agreement raises confidence. Disagreement is reported rather than averaged, for the reason in section 7. |
| A hard timeout | The panel does not wait indefinitely. When the deadline passes, P3 is `unavailable` and the evaluation is `partial`. |

Everything in `.claude/rules/01-trust-boundaries.md` about prompt injection still holds. Learner text reaches P3 wrapped in delimiters and labelled as data, output is parsed as JSON against a schema and rejected when it does not conform, and a design answer asking for full marks scores on content.

---

## 7. The consolidator

Three panelists produce findings. The learner sees one verdict, one score and one piece of feedback.

### Who decides what

| Decision | Owner | Rule |
|---|---|---|
| Verdict | P1 | A failed deterministic gate is a fail. Nothing P2 or P3 says can overturn it, and nothing they say can create a fail on its own. |
| Score, where deterministic gates exist | P1 | The formula in `03` section 5 is unchanged. |
| Score, where they do not (`design`, and the rubric half of `prompt` and `voice`) | P2 and P3 | Banded, as section 8 describes. |
| Feedback prose | All three, merged | One voice, ordered by what helps most. |
| Confidence | The consolidator | A function of which panelists ran and whether they agreed. |

### Disagreement is reported, never averaged

When P2 and P3 both score an artefact and land more than one band apart, the consolidator does not take the mean. It marks `disagreement` on the record, holds the lower band, and surfaces the row to faculty.

Averaging two judges who disagree produces a number that looks confident and hides the one fact worth knowing, which is that this answer is hard to grade. A cohort's most interesting submissions are the ones where the panel argued, and silently averaging them throws that away.

### The one voice

Feedback prose is consolidated so the learner reads a single reviewer, which is what your interviewer will sound like. Provenance is kept in the record and never shown to the learner.

The moment a learner disputes a grade, the appeal path and the faculty view can say which finding came from a deterministic gate and which came from a model's judgement. A platform that cannot answer that question loses the argument by default.

---

## 8. Bands, and why not raw scores

P2 and P3 produce bands rather than points on a hundred-point scale.

| Band | Meaning |
|---|---|
| `strong` | The answer would pass the round. |
| `adequate` | The answer would survive the round and invite a follow-up. |
| `weak` | The answer would not pass. |
| `off_question` | The answer addresses something else. |

A model asked for a number invents precision it does not have, and two runs of the same model on the same answer produce 71 and 78 while agreeing entirely about what the answer is. Bands are stable across runs, they are what an interviewer actually decides, and they map onto a score once at the consolidator rather than three times in three places.

Band-to-score mapping lives in the policy module, so changing what `adequate` is worth is one file.

---

## 9. Degradation, which is the point of the panel

| Panelists available | Evaluation state | What the learner gets |
|---|---|---|
| P1, P2, P3 | `complete` | Full verdict, full feedback, confidence `high`. |
| P1, P2 | `partial` | Verdict and band. Feedback is shorter. The record says detailed review is pending and the re-run is queued. |
| P1 only | `partial` | Verdict and deterministic findings. Enough to keep working. |
| P1 unavailable | `error` | No verdict. **The allowance is not consumed.** This is the existing rule in `03` section 8 and it does not soften here. |

Two rules make degradation safe rather than merely graceful.

**A missing panelist never lowers a score.** If P3 would have contributed points and P3 was down, the learner is not charged for the outage. The evaluation is `partial`, the score is marked provisional, and a free re-evaluation is queued.

**A re-evaluation never consumes an allowance.** It is the platform finishing work it already owed.

**A panelist this deployment does not have is `skipped`, not `unavailable`.** The two look alike and mean opposite things. A worker image built without the embedding model on disk will never encode anything, so calling that an outage marks every design evaluation `partial` and queues a free re-run that nothing will ever drain, and a promise nobody drains is worse than a plain absence. An outage is a timeout, a crash, or a response that did not parse, and those are worth a re-run because the next attempt may work. In code the split is one function, `statusFor` in `web/lib/eval/pretrained.ts`: `model_missing`, `dependency_missing` and `spawn_failed` are absence; everything else is an outage.

The learner-facing message names the next action, per `.claude/rules/02-writing.md`: "Your submission was graded against the deterministic checks. The detailed review is still running and will appear here within the hour. Your attempt has been counted once."

---

## 10. The evaluation record

One row per submission per evaluation attempt. Immutable. A re-run writes a new row and the latest complete row wins.

```json
{
  "evaluation_id": 91823,
  "submission_id": 38191,
  "complexity": "C3",
  "state": "complete",
  "verdict": "fail",
  "score": 62.5,
  "score_provisional": false,
  "confidence": "high",
  "panel": [
    {"panelist": "static", "status": "ran", "ms": 41,
     "findings": [{"code": "hidden_gate_failed", "detail": "5 of 7", "severity": "blocking"}],
     "score_contribution": 62.5},
    {"panelist": "pretrained", "status": "ran", "ms": 180,
     "findings": [{"code": "structural_match_naive", "detail": "0.91 to naive_no_retry",
                   "severity": "informational"}],
     "band": "weak"},
    {"panelist": "llm", "status": "unavailable", "reason": "deadline_exceeded", "ms": 4000}
  ],
  "disagreement": null,
  "feedback_md": "Your loop detects the error and does not retry before degrading...",
  "created_at": "2026-09-20T09:14:02Z"
}
```

| Field | Read by |
|---|---|
| `verdict`, `score`, `feedback_md` | The learner, through the result contract. |
| `panel`, `disagreement`, `confidence` | Faculty, the appeal path, and `analytics/`. Never the learner. |
| `complexity`, `state` | `analytics/`, for calibration and for outage reporting. |

### How this maps onto the existing result contract

The result contract in `03` section 5 does not change shape. The front end keeps rendering `verdict`, `score`, `gates` and `budget` exactly as it does. Two fields are added to it:

```json
"feedback_md": "...",
"evaluation": {"state": "partial", "confidence": "medium", "provisional": true}
```

`gates` continues to be P1's output, because that is what it always was. P2 and P3 never appear in `gates`, since a gate is something that passes or fails and a band is not.

---

## 11. Validator rules this adds

Checked in CI on every problem, per the rule in `CLAUDE.md` that problem YAML is validated in CI and not at import.

| Rule | Reason |
|---|---|
| Every problem declares `complexity`, one of C1 to C5. | The panel cannot assign panelists without it. |
| A problem declaring P2 or P3 declares P1 checks too. | The outage fallback is structural rather than hoped for. |
| A C4 or C5 problem declares P3. | Those levels have no deterministic answer and a panel of one would be guessing. |
| A C1 problem declares no P3. | Spending a model call on an exact-match question is waste that compounds across a cohort. |
| Every heuristic named in a problem exists in the heuristic registry. | An author inventing a heuristic inline produces a rule that fails at run time in front of a learner. |
| Every design problem has at least three graded exemplars. | P2's nearest-neighbour vote needs anchors. This rule already exists and now has a second reason. |
| Every problem declares `interview_evidence` with a non-empty `asked_as`. | Section 12. |

Per the standing rule, any new heuristic ships with a fixture, a unit test and a registry entry, or it does not ship.

---

## 12. The relevance gate

Every problem exists to prepare somebody for a technical round. That is the North Star, and a North Star that CI cannot check is a wish.

```yaml
interview_evidence:
  round: oral                    # written | oral | both
  asked_as: |
    "Walk me through how you guarantee that agent loop terminates."
  source: |
    Author judgement from FDE screen debriefs, 2026 Q2.
```

| Field | Rule |
|---|---|
| `round` | One of `written`, `oral`, `both`. Decides whether the problem can appear in a Voice Screen. |
| `asked_as` | The question in the words an interviewer would use. Not a paraphrase of the brief. |
| `source` | Where the claim comes from. An author who cannot name a source writes "author judgement" and does not invent one. |

The validator checks the fields exist and are non-empty. It cannot check that a claim is true, so the authoring skill asks for the source out loud and the review is where a false one gets caught.

`analytics/` reports coverage across rounds, which is how you find out that the catalogue has drifted toward written problems while learners keep failing oral rounds.

---

## 13. Module boundary

`eval/` is the only writer of `evaluation` and of `competency_score`. Nothing else computes a grade, a band or a competency state.

| Module | May | May not |
|---|---|---|
| `eval/` | Write `evaluation`, write `competency_score`, read anything. | Execute learner code. Render. Decide caps or scaffolding. |
| `progress/` | Read `evaluation` and `competency_score`. | Write either. Recompute a grade. |
| `analytics/` | Read `evaluation`, `submission`, `problem`. | Write anything a learner sees. Recompute a grade. |

The rule that makes it worth enforcing: a heatmap that disagrees with a report card is a bug nobody can find, because two pieces of code computed the same number from the same rows in different ways. One writer removes the category.

---

## 14. Acceptance for this phase

1. A C1 problem grades with P1 alone, makes no model call, and returns in under 100ms.
2. A C4 problem with Bedrock unreachable returns a `partial` evaluation carrying P1 and P2 findings, a provisional score, and a queued re-run. No allowance is consumed twice.
3. A re-evaluation of a `partial` record produces a `complete` record and the learner's score changes only upward or stays equal.
4. P2 assigns a band to a design answer with no network call, tested with the interface offline.
5. Every heuristic in the registry runs against all 25 reference solutions and fires on none of them.
6. A problem declaring P3 without P1 fails CI, with the file and the line named.
7. Two judges disagreeing by two bands produce `disagreement` on the record, the lower band as the score, and a row in the faculty view.
8. The learner-facing payload contains no panelist name, verified by a test that greps the serialised result contract.

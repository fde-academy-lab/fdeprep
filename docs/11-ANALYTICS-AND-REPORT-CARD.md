# FDE Prep: analytics and the report card

Audience for this document: the engineer or coding agent building the system. Everywhere below, "you" means that builder.

This specifies `analytics/`. It reads what the evaluation panel wrote and never grades anything. Read `10-EVALUATION-PANEL.md` first for the record it reads, and `12-PROGRESS-AND-READINESS.md` for the module it sits beside.

---

## 1. The question this module answers

`progress/` answers one question about one learner: is this person ready, and where are they weak.

`analytics/` answers three questions nobody else can:

| Question | Who asks | Why it has no other home |
|---|---|---|
| How is this cohort doing? | The cohort lead, weekly. | It is an aggregate across learners, and `progress/` is scoped to one. |
| Which problems are miscalibrated or broken? | The author, before the next cohort. | It is an aggregate across submissions to one problem, which no learner view sees. |
| Is the panel healthy? | The operator, daily. | Outage rates and disagreement rates are properties of the evaluation system rather than of anybody's learning. |

A module that answers all three is coherent. A module that also grades is not, which is why section 6 says what it may never do.

---

## 2. Reader only, and what that buys

`analytics/` holds no grading logic. Every number it shows is an aggregate over rows that `eval/` wrote.

The failure this prevents is specific and expensive. Two pieces of code computing "percentage of competencies at mastered" from the same rows will eventually disagree, because one of them will be updated when the scoring rule changes and the other will not. A learner then sees 62 percent on their progress screen and 58 percent on the report card sent to placement, and nobody can say which is right.

One writer removes the category of bug rather than fixing instances of it.

---

## 3. The report card

A dated snapshot of one learner, generated on request, shareable outside the platform.

The heatmap is live and changes as the learner works. A placement team needs a document that does not change after they read it, that carries the date it was made, and that can be attached to an email. Those are different artefacts and conflating them was the thing to avoid.

### What it carries

| Section | Content |
|---|---|
| Header | Learner, cohort, track, persona, the date it was generated, and the evaluation count it summarises. |
| Readiness | The single signal from `12` section 2, with the count of competencies in each of the four states. |
| Competency detail | Per competency: attempts, best state reached, the difficulty at which it was reached, and whether it was reached without hints and within budget. |
| Evidence | Up to five submissions that best demonstrate the learner's ceiling, each with the problem, verdict, score and a link to the trace. |
| Voice | Beat timings, pace and rubric bands across the voice sessions taken, since an FDE screen is half spoken. |
| Interview coverage | Which rounds the learner has practised, from `interview_evidence` on the problems they attempted. A learner who has only done written problems has a gap the readiness number will not show. |
| Caveats | What this document does not measure, stated plainly. |

### The caveats section is required

A report card that only lists strengths gets discounted by whoever reads it, and discounted readiness numbers were the thing this platform exists to fix.

Every report card states: the number of problems attempted out of the catalogue, whether any evaluation in the sample was `partial`, and that the platform measures agent engineering rather than general software ability. A reader who knows the limits trusts the parts inside them.

### Generation and storage

The report card is generated from the evaluation records at a point in time and stored as a row with its generated timestamp and a content hash. Regenerating produces a new row. An old card stays readable, because somebody has it in their inbox and it has to keep meaning what it meant.

---

## 4. Cohort views

Four tables, each a plain table with a filter row, following the density direction in `08-DESIGN-SYSTEM.md`.

| View | Rows | The decision it drives |
|---|---|---|
| Cohort standing | One learner per row: readiness, attempts, last activity, competencies mastered. | Who needs a conversation this week. |
| Stuck list | One learner-problem pair per row, where three or more failed submissions have no pass. | Where to spend office hours. |
| Competency gaps | One competency per row: cohort attempt rate, pass rate, mean best state. | What the next session has to cover. |
| Interview coverage | One round per row: how many problems in the catalogue, how many the cohort has attempted. | Whether the catalogue has drifted away from what interviews ask. |

The stuck list is the one that earns its place daily. A learner failing the same problem four times is a learner about to quit, and the attempt notes on Hard problems are already text a faculty member can read.

---

## 5. Problem calibration

The feedback loop that makes the content improve, and the reason to keep evaluation records rather than only final scores.

| Signal | Threshold worth looking at | What it usually means |
|---|---|---|
| First-attempt pass rate | Above 90 percent on Medium or higher. | The problem is easier than its tier, or the hidden tests are guessable. |
| First-attempt pass rate | Below 10 percent with a high give-up rate. | The brief is unclear, or the contract is wrong, rather than the problem being hard. |
| Panel disagreement rate | Above 20 percent of evaluations. | The rubric is ambiguous, or the exemplars do not span the answer space. |
| Hint reveal rate | Above 80 percent on Easy. | The stub or the step checklist is not doing its job. |
| Mean time to pass | Far above `est_minutes`. | The estimate is wrong, which matters because learners plan around it. |

These are thresholds to look at rather than rules to act on, and the document says so because an author who treats a threshold as a verdict will rewrite a problem that was fine.

**The calibration report is written for the author, not for the learner.** It names the problem, the signal, the number, and what to check first.

### Exemplar coverage

One calibration number belongs to the panel rather than to the problem: how many graded answers sit in P2's nearest-neighbour index for each problem.

A design problem with three author-written exemplars and no graded learner answers has a P2 that is guessing between three points. The same problem after a cohort has 200 points and a P2 worth trusting. The report shows the count so nobody over-reads an early band.

---

## 6. Panel health

Read daily by whoever is operating the platform, and the numbers that say whether the evaluation system is working rather than whether learners are.

| Metric | Why it matters |
|---|---|
| Evaluations by state, `complete` against `partial` against `error`. | A rising `partial` rate is an outage the learners are absorbing quietly. |
| Panelist availability, per panelist, per hour. | Names which panelist is down before somebody reports thin feedback. |
| P3 median and p95 latency. | The deadline that sends an evaluation to `partial` is a number, and this is how you know it is the wrong one. |
| Re-evaluation backlog. | Every `partial` owes a free re-run, and an unbounded backlog means the debt is not being paid. |
| Disagreement rate across the catalogue. | Distinguishes one ambiguous rubric from a systemic problem with the judge prompt. |

The re-evaluation backlog is the one with teeth. A `partial` evaluation is a promise to the learner, and a promise nobody drains is worse than a plain failure, because the learner is still waiting.

---

## 7. Exports

| Export | Format | Consumer |
|---|---|---|
| Report card | PDF and Markdown. | Placement, and the learner. |
| Cohort standing | CSV. | The programme manager's spreadsheet, which is where cohort decisions actually get made. |
| Attempt history | CSV. | Exists today on `/progress`, kept unchanged. |
| Calibration report | Markdown. | The author, before the next cohort. |

Every export carries the date it was generated and the count of rows it covers. An undated export of a live system is a number somebody will quote six months later.

---

## 8. What this module may never do

| Never | Because |
|---|---|
| Compute a grade, a band or a competency state. | `eval/` owns those. Two writers produce two answers. |
| Write to `evaluation`, `submission` or `competency_score`. | Reader only, enforced by the database role the analytics queries run under. |
| Show a learner a number that `progress/` does not also show. | A learner seeing 62 on one screen and 58 on another stops believing both. |
| Show one learner another learner's standing. | Cohort views are faculty and admin only, per the roles in `00-PRD.md` section 2. |
| Surface panelist identity to a learner. | `10` section 7. The panel speaks with one voice to the learner and keeps provenance for faculty. |

---

## 9. Acceptance for this phase

1. A report card generated twice from unchanged data produces the same content hash.
2. A report card generated after a new evaluation produces a different hash and a new row, and the old row is still readable.
3. Every readiness number on a report card matches the number `progress/` shows for the same learner at the same moment, verified by a test that reads both.
4. The analytics database role has no write grant on `evaluation`, `submission` or `competency_score`, verified by a test that attempts a write and expects a refusal.
5. The stuck list finds a learner with three failed submissions and no pass, and excludes one who failed three times and then passed.
6. Panel health reports a `partial` rate that matches the count of `partial` rows, with no double counting when a re-evaluation later completes.
7. A cohort view requested by a learner account is refused, and the refusal names who can see it.
8. The calibration report names a problem whose first-attempt pass rate is above 90 percent on Medium, tested against seeded rows.

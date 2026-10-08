# FDE Prep: progress and the readiness signal

Audience for this document: the engineer or coding agent building the system. Everywhere below, "you" means that builder.

This specifies `progress/`, which answers one question about one learner: are they ready, and where are they weak. Read `10-EVALUATION-PANEL.md` for the record it reads and `11-ANALYTICS-AND-REPORT-CARD.md` for the module beside it.

Most of this module exists. This document states the boundary it sits behind and defines the readiness signal, which `web/lib/progress/readiness.ts` computes.

---

## 1. What this module owns

| Owns | Does not own |
|---|---|
| The competency state machine and its one-way transitions. | Grading. `eval/` produces every verdict, band and score. |
| The heatmap, which is screen S9. | Anything about a cohort. `analytics/` aggregates across learners. |
| The readiness signal in section 2. | Any number a learner does not see. |
| The attempt history and its CSV export. | Writing to `evaluation`. |

The state machine is unchanged from `02-DATA-MODEL.md` section 7 and from the code that implements it:

```
untouched ──► attempted ──► passed ──► clean
```

One-way. A `clean` cell never degrades because a later run was scruffy, and a verdict the learner did not earn moves nothing. An `error`, a timeout, a cancellation or a rejection leaves the cell exactly as it was, for the same reason an `error` never consumes an allowance: a runner that died is not evidence about a learner.

---

## 2. The readiness signal

The platform exists to produce one signal the placement side can trust. `readinessFor` in `web/lib/progress/readiness.ts` computes it from the heatmap's cells, and Home, Progress, the admin Overview and the report card read it from there.

```
readiness = clean cells / cells the learner's track requires
```

Three properties make the number worth quoting.

| Property | Consequence |
|---|---|
| Only `clean` counts. | A pass with four hints revealed and double the call budget is real progress and is not evidence of readiness. |
| The denominator is the track, not the catalogue. | A learner on the Agentic AI track is not marked down for untouched problems on the other track. |
| It never moves backward. | `clean` is one-way, so a learner who stops practising does not decay. The report card carries the date instead, which is the honest way to say the number is old. |

### What it is reported with, always

A bare percentage invites over-reading. The signal is rendered and exported as four numbers together:

```
Readiness 34%          clean 9 · passed 4 · attempted 6 · untouched 7
```

A learner at 34 percent with 4 passed and 6 attempted is mid-flight. A learner at 34 percent with 0 passed and 0 attempted has done nine problems and stopped. Those are different people and one number cannot tell them apart.

### Bands, for the placement conversation

| Band | Readiness | What it claims |
|---|---|---|
| `not_ready` | Below 40 percent. | Not enough evidence to put in front of a screen. |
| `developing` | 40 to 69 percent. | Ready for practice rounds, not for a real screen. |
| `screen_ready` | 70 percent or above, with at least one `clean` cell at Hard or Extreme. | The evidence supports a real technical screen. |

The Hard-or-Extreme condition is the one that stops the band being gamed. Seventy percent made entirely of Easy cells is a learner who has practised the easy half thoroughly, and an FDE screen is not the easy half.

---

## 3. The heatmap

Screen S9, unchanged in shape from `01-WIREFRAMES.md`. One row per competency, one column per difficulty, four cell states.

What changed is where the cells come from. **Amended 8 October 2026:** `competency_score` is written by `web/lib/eval/competency.ts`, under the boundary in `10` section 13. `writeResult` calls it inside the transaction that commits the verdict, and the faculty override calls it to recompute a learner's cells. `progress/` reads the cells and writes nothing. The write moved between modules and no table changed, so the move needed no migration.

---

## 4. Partial evaluations

A `partial` evaluation is one where a panelist was unavailable, per `10` section 9. It affects progress in one specific way and no other.

| Situation | Effect on the cell |
|---|---|
| `partial` with a deterministic verdict of `fail`. | Moves to `attempted`, as a fail always does. P1 was enough to know it failed. |
| `partial` with a deterministic verdict of `pass`. | Moves to `passed` or `clean` as normal. P1 was enough to know it passed. |
| `partial` where the verdict itself depends on a missing panelist, which is design problems at C4. | Moves nothing. The cell waits for the re-evaluation. |
| `error`. | Moves nothing, consumes nothing. |

The third row is the one to get right. A design answer graded by P1 and P2 while P3 was down has a provisional score and no defensible verdict, and writing a competency state from it would put a number into the readiness signal that the platform cannot stand behind.

The learner sees the provisional score and the pending notice. The heatmap stays honest by waiting.

---

## 5. The gap the readiness number does not show

A learner can reach `screen_ready` having practised only written-format problems, because the competency vocabulary says nothing about interview format.

`progress/` reads `interview_evidence.round` from the problems a learner has attempted and surfaces coverage beside the signal:

```
Readiness 72%  screen_ready        Practised: written 14 · oral 2
```

Two oral attempts against fourteen written ones is a learner who will be surprised by half of their screen. The number is not wrong and it is not the whole picture, and showing both costs one line.

**Amended 8 October 2026**, story S15.5. `coverageFor` in `web/lib/progress/coverage.ts` counts it, and the readiness line on Home, Progress and the admin learner page shows `Practised: written 14 · oral 2` beside the band. A problem counts once, no matter how often it was submitted, toward the round its current version declares, and a problem marked `both` counts toward each. Practised means a submission with a verdict the learner earned, pass or fail, which is the evidence that moves a heatmap cell, so an error or a timeout practises nothing. Voice answers are not counted here: the line reads problems, as this section says.

---

## 6. Module boundary

```
        eval/  ──writes──►  evaluation, competency_score
                                 │
                   ┌─────────────┴─────────────┐
                   ▼                           ▼
            progress/  reads              analytics/  reads
            one learner                   many learners
```

| Rule | Enforcement |
|---|---|
| `progress/` never writes `evaluation` or `competency_score`. | `web/tests/writer-boundary.test.ts` fails on any write under `progress/`. Behind it, the role `fdeprep_reader` from migration 026 has no write grant, tested by a write it attempts and is refused. `progress/` does not run under that role in this release (amended 8 October 2026). |
| `progress/` never recomputes a grade. | Review, plus the absence of any scoring import in the module, which the same test checks: `progress/` may import types from `eval/` and nothing that runs. |
| Every number `progress/` shows, `analytics/` derives from the same rows. | A test reads the readiness number from both modules for the same learner and asserts equality. `web/tests/report-card.test.ts` does it inside one transaction, including a change no other connection can see yet, and `web/tests/admin-overview.test.ts` does it for every Overview row. |

---

## 7. Acceptance for this phase

1. The readiness signal computes from `clean` cells over track-required cells, and a learner with no attempts returns 0 with the four counts all zero except `untouched`.
2. A learner at 70 percent whose `clean` cells are all Easy is banded `developing`, not `screen_ready`.
3. A `clean` cell stays `clean` after a later failed submission against the same competency.
4. An `error` verdict moves no cell and consumes no allowance, tested together because they share a cause.
5. A `partial` evaluation on a C4 design problem moves no cell, and the re-evaluation that completes it does.
6. A `partial` evaluation with a deterministic `fail` moves the cell to `attempted` without waiting.
7. The readiness number from `progress/` equals the number on the report card generated in the same transaction.
8. The reader role, `fdeprep_reader`, cannot write `competency_score`, verified by an attempted write that is refused (`web/tests/reader-role.test.ts`).
9. Interview coverage counts distinct problems attempted per round, and a problem marked `both` counts toward each.

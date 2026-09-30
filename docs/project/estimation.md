# Estimation

How big each piece of work was, how the sizes were estimated, and how fast the build moved. Estimates and facts sit in separate columns throughout.

## What is a fact and what is an estimate

| Figure | Kind | Where it comes from |
|---|---|---|
| Dates, pull requests, commits, lines changed | Fact | GitHub's record of each pull request, and git. |
| Test cases at the end of a stage | Fact | Test declarations counted in git at the stage's last merge. A parametrised test counts once here, so the Python suite collects more cases than this count shows. |
| Story points | Estimate | Relative sizing, described below. |
| Person-days for a human team | Estimate | Three-point estimates, described below. |
| RICE scores and forecast windows | Estimate | [roadmap.md](roadmap.md) says how. |

The build was carried out by an AI coding agent working through the specification with one person directing it. No log of hours exists, so none is shown. The person-day figures answer a different question: what a team of two senior engineers would have needed for the same scope.

## Story points

Each story was sized against reference stories, the way a team sizes in planning poker: is this bigger or smaller than one we already agreed on? The scale is Fibonacci, 1, 2, 3, 5, 8, 13 and 21, because the gaps widen where certainty drops.

| Points | Reference story | Why it is that size |
|---|---|---|
| 1 | S4.3, making a rule in docs/04 and its own worked example agree (#13) | One file, one idea, no new code. |
| 3 | S8.8, recording a call the budget refuses (#39) | One runner change, a trace format change and a new test file. |
| 8 | S6.3, the evaluation panel and its record (#25) | A new module with its own acceptance tests and a schema. |
| 13 | S1.4, prompt surgery, the design argument and the judge (#4) | A second Lambda, two new screens and a rule engine. |
| 21 | S1.2, the application and the submission pipeline (#2) | The largest single delivery before the revamp: the app, the validator, two screens and the transactional queue. |

## Three-point estimates

Each stage has an optimistic, a likely and a pessimistic figure in person-days. The expected value is (O + 4M + P) / 6 and the standard deviation is (P - O) / 6, the PERT method. Summed across stages, the standard deviations combine as the square root of the sum of their squares, which assumes the stages' surprises are independent.

<!-- generated:estimates -->
| Stage | Points | Optimistic | Likely | Pessimistic | Expected | Std dev |
|---|---|---|---|---|---|---|
| S0 Foundation | 19 | 6 | 10 | 18 | 10.7 | 2.0 |
| S1 Core grading platform | 62 | 25 | 40 | 70 | 42.5 | 7.5 |
| S2 Learner journey and operations | 21 | 8 | 14 | 24 | 14.7 | 2.7 |
| S3 Voice Screen | 29 | 12 | 20 | 35 | 21.2 | 3.8 |
| S4 Launch content | 30 | 12 | 18 | 30 | 19.0 | 3.0 |
| S5 First real use | 25 | 5 | 8 | 14 | 8.5 | 1.5 |
| S6 Evaluation panel | 49 | 12 | 20 | 32 | 20.7 | 3.3 |
| S7 Install fixes | 8 | 1 | 2 | 4 | 2.2 | 0.5 |
| S8 Revamp | 82 | 30 | 50 | 90 | 53.3 | 10.0 |
| S9 Beta on AWS | 35 | 6 | 10 | 18 | 10.7 | 2.0 |
| S10 Delivery board | 20 | 2 | 3 | 5 | 3.2 | 0.5 |
| S11 Beta launch | 26 | 3 | 5 | 10 | 5.5 | 1.2 |
| S12 Problem pages v2 | 52 | 8 | 14 | 25 | 14.8 | 2.8 |
| S13 Voice interviewer v2, step 1 | 44 | 10 | 16 | 28 | 17.0 | 3.0 |
| S14 Voice interviewer v2, step 2 | 37 | 10 | 18 | 35 | 19.5 | 4.2 |
| S15 First cohort | 73 | 25 | 40 | 70 | 42.5 | 7.5 |
| S16 Second version | 50 | 30 | 55 | 100 | 58.3 | 11.7 |
| All built stages | 360 |  |  |  | 203.3 | 14.4 |
| All planned stages | 302 |  |  |  | 160.8 | 15.1 |
<!-- /generated:estimates -->

## How fast the build moved

Velocity here is points delivered per day on which something merged. It describes an agent-driven build and does not transfer to a human team.

<!-- generated:velocity -->
| Stage | Points | Days with a merge | Points per day |
|---|---|---|---|
| S0 Foundation | 19 | 1 | 19.0 |
| S1 Core grading platform | 62 | 1 | 62.0 |
| S2 Learner journey and operations | 21 | 1 | 21.0 |
| S3 Voice Screen | 29 | 1 | 29.0 |
| S4 Launch content | 30 | 3 | 10.0 |
| S5 First real use | 25 | 2 | 12.5 |
| S6 Evaluation panel | 49 | 2 | 24.5 |
| S7 Install fixes | 8 | 3 | 2.7 |
| S8 Revamp | 82 | 1 | 82.0 |
| S9 Beta on AWS | 35 | 1 | 35.0 |

Across the build: 360 points landed on 9 distinct days, 40.0 points a day. Some days carried work from two stages, so the stage rows add up to more than 9.
<!-- /generated:velocity -->

## Forecast for the roadmap

Two readings for each planned epic. The first assumes the build's own pace holds; review, deployment and learner feedback will slow it. The second is the human-team estimate from the table above.

<!-- generated:forecast -->
| Epic | Points | Days at the build's own pace | Person-days for a human team |
|---|---|---|---|
| S10 Delivery board | 20 | 0.5 | 3 |
| S11 Beta launch | 26 | 0.7 | 6 |
| S12 Problem pages v2 | 52 | 1.3 | 15 |
| S13 Voice interviewer v2, step 1 | 44 | 1.1 | 17 |
| S14 Voice interviewer v2, step 2 | 37 | 0.9 | 20 |
| S15 First cohort | 73 | 1.8 | 42 |
| S16 Second version | 50 | 1.2 | 58 |
<!-- /generated:forecast -->

## Review wait

GitHub records when each pull request opened and merged. The median was 0.65 hours, the longest 20 hours (#32). The work was finished on a branch before its pull request opened, so this measures review wait. It says nothing about how long the work took.

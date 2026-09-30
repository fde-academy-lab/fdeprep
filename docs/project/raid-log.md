# Risks, assumptions, issues and dependencies

What could go wrong, what the plan takes for granted, what is already wrong, and what the work waits on. Each row names the story on the board that deals with it. Review this page at the start of every stage.

## Risks

| ID | Risk | Likelihood | Impact | Response | Story |
|---|---|---|---|---|---|
| R1 | The Bedrock judge, Amazon Transcribe, Polly and the S3 audio store have never made a live call, so the first learner to use one would be its first test. | High | High | Spend one real submission and one real voice session on them before any learner arrives. | S11.2, S11.3 |
| R2 | One operator runs the platform and also writes the curriculum, so a grading outage on a teaching evening has nobody free to fix it. | High | High | Brief a second operator and run one practice drill. Pausing grading keeps Run working and spends no attempt. | S11.5 |
| R3 | The database restore has never been run, so its procedure is untested. | Medium | High | Restore a backup into a scratch database once and record how long it took. | S11.4 |
| R4 | Peak load, about 30 concurrent submissions after a session, is a projection that has never been measured against a deployment. | Medium | Medium | Run the 200-submission burst test against the deployed stack. | S11.7 |
| R5 | Panelist 2's bands have never been checked against a human grader. | Medium | Medium | Faculty overrides record every disagreement, and analytics will report how often the panel is overruled. | S15.5 |
| R6 | Generated voice follow-ups add a model call between turns, with a cost and a delay nobody has measured. | Medium | Medium | Measure ten sessions before rollout. When the model is late, a prewritten follow-up takes over. | S14.5, S14.1 |
| R7 | A resume is personal data. | Medium | High | Keep only the claims extracted for the session, delete the file at once, never score from it, and say so on the consent screen. | S14.2, S14.6 |
| R8 | An authoring mistake runs up the Bedrock bill. | Low | High | A budget alarm at 50 and 80 percent. Learner code can never reach a model, which bounds the spend by design. | S11.6 |

## Assumptions

| ID | Assumption | If it is wrong |
|---|---|---|
| A1 | Every beta tester has a GitHub account. | Sign-in needs a second identity provider, which the current invite flow does not have. |
| A2 | A beta cohort is a few dozen learners, which the Postgres queue carries without a message broker. | Reinstate a queue between the worker and the functions, as docs/05 first described. |
| A3 | A full cohort is about 180 learners. | The capacity figures in docs/05 and the burst test's target change with it. |
| A4 | The AWS account can use Claude models on Bedrock in its region, after the one-time use-case form and Marketplace subscription. | The judge cannot grade prompt and design answers, and the platform runs code problems only. |
| A5 | Learners practise on laptops. | A mobile reading view moves up from the later horizon. |

## Issues

| ID | Issue | Effect | Story |
|---|---|---|---|
| I1 | The voice screen has no question picker. | Twelve questions are reachable by URL and one by clicking. | S13.3 |
| I2 | The import screen reads problems from disk, which cannot work on a deployment. | Publishing content on a deployed host needs an operator with a shell. | S15.4 |
| I3 | Nothing assigns a learner's persona. | An admin sets it by hand or by CSV. | S15.1 |
| I4 | The README's Size and Built rows date from 20 September. | Two figures in the README header are stale. | The README rewrite at the end of this roadmap |

## Dependencies

| ID | Dependency | Needed by | Owner |
|---|---|---|---|
| D1 | An AWS account with Bedrock model access, and a payment method for the AWS Marketplace subscription the first call starts | S11 | Operator |
| D2 | A domain, DNS for it, and a GitHub OAuth application whose callback matches it | S11.1 | Operator |
| D3 | The repository secret PROJECT_TOKEN, for the board sync | S10.4 | Repository admin |
| D4 | Amazon Transcribe streaming and Polly in the deployment's region | S11.3, S13, S14 | Operator |

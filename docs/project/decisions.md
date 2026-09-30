# Decisions

The decisions that shaped the build, in the order they were made. Each records what forced the choice, what was chosen, what else was on the table, and what it costs. The pull request or document named in each row holds the full argument.

| ID | Date | Decision | Instead of | Why | What it costs | Where |
|---|---|---|---|---|---|---|
| D1 | 14 Sep | Write the whole specification before any code, and treat it as authoritative. | Building from a short brief and learning as it goes. | A disagreement between code and plan gets raised against a written contract instead of settled silently. | 2,843 lines before the first thing could be learned from running code. | README section 7.2 |
| D2 | 14 Sep | Grade code against a scripted model, deterministically. | Grading with a live model. | A verdict anyone can reproduce can be appealed, and the model bill does not grow with practice. | A scripted tool cannot compute from its arguments, so some behaviours need a named fixture in the runner. | docs/00, docs/03 |
| D3 | 14 Sep | PostgreSQL, GitHub sign-in and Lambda containers. | DynamoDB, Cognito and a sandbox priced per session, which an earlier build pack chose. | The workload is joins and aggregates, the learners already live on GitHub, and a Lambda costs nothing idle. | One more database to operate. | docs/09 |
| D4 | 14 Sep | One policy module decides everything that depends on difficulty, and a lint rule enforces it. | Checks spread across screens. | Difficulty behaviour changed four times during the build, and every change touched one file. | A new rule has to be expressed in the policy module's terms. | PR #3 |
| D5 | 14 Sep | Judge prompts live in files. | Prompts in the database. | Changing how a cohort is graded stays a code review. | A prompt change needs a deploy. | PR #4 |
| D6 | 14 Sep | Write the submission, the cap decrement and an outbox row in one transaction, and fence late runners with a lease. | Publishing to a queue after the write. | A submission can never exist without its message, which is the failure the earlier build pack warned about. | A dispatcher and a reaper to run. | PR #2 |
| D7 | 21 Sep | Three evaluators, one consolidated verdict, and only deterministic checks may fail an answer. | A single model grade. | A band nobody can reproduce is a band nobody can appeal, and an evaluator that cannot run never lowers a score. | Three code paths to keep in step, and a faculty queue to staff. | PR #23, docs/10 |
| D8 | 30 Sep | The runner holds the scripted model, the fixtures and the trace, and the sandbox holds proxies. | A static gate as the only control. | The gate could be walked around, and the only boundary that holds is having nothing worth reaching inside the process. | Every model and tool call crosses a pipe. | PR #38 |
| D9 | 30 Sep | The worker invokes the runner and judge functions directly. | SQS between the application and the functions. | The Postgres queue already carries delivery, retries and leases, and a second queue for a few dozen learners adds a place to fail. | Revisit if a cohort outgrows one worker host. | PR #40, docs/05 |
| D10 | 30 Sep | Beta testers get one-time invites, and GitHub stays the only proof of identity. | Email and password accounts. | No password store to secure, and every tester already has GitHub. | Somebody without a GitHub account cannot join. | PR #40 |
| D11 | 30 Sep | The delivery board is generated from a file in the repository. | Cards edited by hand on the Project. | The record is reviewed like code, and a sync puts back anything edited by hand. | Views must be made by hand once, because GitHub's API cannot create them. | This folder |

## Deliberately not built

A roadmap that only grows is one nobody trusts, so these are recorded as decisions too. The argument for each is in README section 8.4.

| Not building | Because |
|---|---|
| Free and paid tiers | A tier adds a reason to argue about access instead of about answers. |
| A discussion forum | GitHub already has one. |
| Live model grading as the default | It gives verdicts nobody can reproduce and a bill that grows with practice. The capped live run exists for exploration and gives no verdict. |
| A mobile workspace | A three-pane editor on a phone is a worse version of what already works on a laptop. |

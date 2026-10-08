# Quality

How bugs were found, what they were, and how the test count grew stage by stage.

## How bugs were found

Every bug on the board says how it surfaced, because the method says what kind of checking the build still lacks.

| Found by | Meaning |
|---|---|
| Reading | Someone read a specification or a vendor's documentation against the code and found a disagreement. |
| Measuring | A figure that had been assumed was measured, and it was wrong. |
| Running it | Someone used the product end to end and hit the fault. |
| Testing | A test, a mutant of a reference solution, or a browser check exposed it. |
| Beta tester | A person using the beta reported it. |

<!-- generated:quality -->
| Stage | Reading | Measuring | Running it | Testing | Beta tester | Test cases at the end |
|---|---|---|---|---|---|---|
| S0 Foundation | 0 | 0 | 0 | 0 | 0 | 0 |
| S1 Core grading platform | 1 | 0 | 0 | 0 | 0 | 261 |
| S2 Learner journey and operations | 0 | 0 | 0 | 0 | 0 | 371 |
| S3 Voice Screen | 0 | 0 | 0 | 0 | 0 | 513 |
| S4 Launch content | 2 | 2 | 0 | 0 | 0 | 548 |
| S5 First real use | 0 | 0 | 4 | 0 | 0 | 597 |
| S6 Evaluation panel | 0 | 0 | 0 | 0 | 0 | 758 |
| S7 Install fixes | 0 | 0 | 3 | 0 | 0 | 775 |
| S8 Revamp | 1 | 0 | 0 | 1 | 0 | 991 |
| S9 Beta on AWS | 2 | 0 | 0 | 1 | 2 | 1055 |
<!-- /generated:quality -->

The column counts come from the stories in [backlog.yaml](backlog.yaml), and the test cases from git at each stage's last merge.

## Every bug, and where it was fixed

<!-- generated:bugs -->
| Story | What was wrong | Found by | Stage | Fixed in | Priority |
|---|---|---|---|---|---|
| S1.5 | Correct the seed and top_p in docs/03, and state the judge's thinking mode | Reading | S1 Core grading platform | #5 | P0 Critical |
| S4.2 | Stop learner code reading the scripted model | Reading | S4 Launch content | #12 | P0 Critical |
| S4.3 | Make the budget rule in docs/04 and its own worked example agree | Reading | S4 Launch content | #13 | P1 High |
| S4.4 | Cut every voice budget by a third, to 138 words a minute | Measuring | S4 Launch content | #14 | P1 High |
| S4.6 | Move seconds onto the beats that carry the words | Measuring | S4 Launch content | #16 | P1 High |
| S5.1 | Sign in with GitHub, so two learners are two people | Running it | S5 First real use | #17 | P0 Critical |
| S5.2 | Add the worker that drains the queue | Running it | S5 First real use | #18 | P0 Critical |
| S5.3 | Keep test fixtures out of the catalogue, and let local sign-in through | Running it | S5 First real use | #19 | P0 Critical |
| S5.4 | Publish content with a command, and serve the twelve voice questions | Running it | S5 First real use | #20 | P0 Critical |
| S7.1 | Install boto3 for the local judge, and test that it is there | Running it | S7 Install fixes | #34 | P1 High |
| S7.2 | Install panelist 2's runtime, and name the right fix when it is missing | Running it | S7 Install fixes | #35 | P1 High |
| S7.4 | Stop the web tests wiping the development database | Running it | S7 Install fixes | #37 | P1 High |
| S8.6 | Move the harness out of the sandbox and close the escape routes | Reading | S8 Revamp | #38 | P0 Critical |
| S8.8 | Record a call the budget refuses, and count it as a call asked for | Testing | S8 Revamp | #39 | P0 Critical |
| S9.2 | Make the stack deploy from a clean account | Reading | S9 Beta on AWS | #40 | P0 Critical |
| S9.3 | Accept India's and Japan's Bedrock inference profiles | Reading | S9 Beta on AWS | #40 | P0 Critical |
| S9.6 | Stop browser extensions tripping the hydration check | Beta tester | S9 Beta on AWS | #40 | P0 Critical |
| S9.7 | Bring undo back in both editors | Testing | S9 Beta on AWS | #40 | P0 Critical |
| S9.8 | Stop re-rendering the whole workspace on every key | Beta tester | S9 Beta on AWS | #40 | P1 High |
| S12.19 | Let a solution use LangChain core or pydantic without LangGraph in the sandbox | Running it | S12 Problem pages v2 | #45 | P1 High |
| S13.8 | Fix the eight defects that made the voice screen unreliable | Reading | S13 Voice interviewer v2, step 1 | #44 | P1 High |
| S13.9 | Keep the debrief up, and say what failed when an answer does not save | Running it | S13 Voice interviewer v2, step 1 | #45 | P1 High |
| S15.10 | Make a Run execute the public cases only, as the spec always said | Reading | S15 First cohort | planned | P0 Critical |
<!-- /generated:bugs -->

## What the pattern says

Stage S5 is the one to remember. Phases 1 to 8 produced a system that passed 685 tests and had never been used, and the first afternoon of use found four faults, one of them no authentication at all. The test suite showed the code did what the tests said. Only running the product showed whether it worked. Since then every stage has closed with the product run end to end: a browser script for the workspace in S9, and the running app for the steps checklist in S8.

Reading found most of the rest, which is the case for writing a specification first: a rule and its own example that disagree, or a vendor API that cannot take the parameters the plan asked for, are faults no test written from the same plan would catch.

## The suites today

| Suite | Tests | Runs in CI as |
|---|---|---|
| Web, vitest | 717 | Web typecheck and tests |
| Python, pytest | 980 collected, of which 33 skip in a cloud session and fewer in CI | Runner tests |
| Infrastructure, the Node test runner | 37 | Infrastructure synth and assertions |
| Voice package, the Node test runner | 26 | Voice package tests |

Content has its own gate: every problem and voice question validates in CI before it can be imported.

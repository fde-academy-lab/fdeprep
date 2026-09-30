# Delivery history

Every stage of the build, what it delivered, why it mattered and what it taught, with the stories inside it and the pull request behind each one. Dates are India time. Points are estimates on a relative scale; [estimation.md](estimation.md) explains them. Change sizes and dates are facts from GitHub.

A stage here is what an enterprise team would call an epic or a release train. S0 to S4 follow phases 0 to 8 of the build plan in [docs/06](../06-BUILD-PLAN.md). Each stage after S4 answered something the plan had not foreseen: the first real use, the evaluation panel, the install gaps, the revamp and the beta.

| Build | Stages | What it proved |
|---|---|---|
| Proof of concept | S0 and S1 | Learner code can be graded deterministically against a scripted model, inside a sandbox that holds nothing worth stealing. |
| Minimum viable product | S2 to S4 | A learner can practise, rehearse and speak an answer, and a placement team can read the result. |
| Alpha | S5 to S7 | The first people to run it found what the tests could not, and each fault got fixed with a test that would have caught it. |
| Beta candidate | S8 and S9 | 92 problems, a coached workspace, a hardened sandbox and a deploy that works from a clean AWS account. |

<!-- generated:history -->
### S0 Foundation

**14 Sep 2026.** Ten numbered documents, 2,843 lines, specified the product before any code was written: what a learner does, how grading works, the data model, deployment, the Voice Screen and the design system. The agent that built it got written rules, a curated set of skills and a check that runs before anything merges.

**Why it mattered.** Every later disagreement between the code and the plan was settled against the specification, and each change to the plan was written into it where the next reader would find it.

**What it taught.** Writing 2,843 lines first delays the first thing you can learn from running code. It paid back in the Voice Screen, whose hardest rule, no transcript while the learner speaks, was written down before any cockpit existed and never had to be undone.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S0.1 | Write the specification before any code | Task | b86a1ae, 03e128a | 13 |
| S0.2 | Give the agent written rules, curated skills and a pre-merge check | Task | f237837, 75b74f6, 8bcff2a, d8e956f | 5 |
| S0.3 | Record the one exception to the no-push-to-main rule | Task | fab19ff | 1 |

From git: 7 commits, +33,784 and -125 lines across 195 files.

### S1 Core grading platform

**14 Sep 2026.** Learner code runs in a sandbox against a scripted model and is graded the same way every time. The platform also decides what help each difficulty shows, caps attempts, and grades prompts and design answers with a model judge.

**Why it mattered.** Deterministic grading is why a verdict can be reproduced and appealed, and why the model bill does not grow with how much learners practise.

**What it taught.** Reading the vendor's documentation against the specification found a specification error and a live bug in the judge on the same day, PR #5.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S1.1 | The runner: a scripted model, adversarial fixtures and a static gate | Feature | #1 | 13 |
| S1.2 | Problems, the code workspace and the submission pipeline | Feature | #2 | 21 |
| S1.3 | The scaffold ladder, attempt caps and the step protocol | Feature | #3 | 13 |
| S1.4 | Prompt surgery, the design argument and the model judge | Feature | #4 | 13 |
| S1.5 | Correct the seed and top_p in docs/03, and state the judge's thinking mode | Bug, found by reading | #5 | 2 |

From git: 10 commits, +20,577 and -217 lines across 180 files.

### S2 Learner journey and operations

**15 Sep 2026.** Learners got persona roadmaps, a progress heatmap a placement team reads, a replay of what their agent actually did and a timed rehearsal, and operators got the admin screens, a switch that pauses grading and the first infrastructure code.

**Why it mattered.** A score alone cannot show whether someone is ready. The heatmap and the trace replay are what a reviewer trusts.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S2.1 | Tracks, the progress heatmap and trace replay | Feature | #6 | 8 |
| S2.2 | Rehearsal, admin screens, degraded mode and the CDK stack | Feature | #7 | 13 |

From git: 3 commits, +6,572 and -45 lines across 67 files.

### S3 Voice Screen

**15 Sep 2026.** Learners can practise interview answers out loud: a consent step and a microphone check lead into live transcription, a cockpit with five instruments and three modes, and a debrief that scores content, structure and pace and reports delivery without scoring it.

**Why it mattered.** Forward deployed engineers are hired in conversation, and answering out loud against a clock is a different skill from writing the same answer.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S3.1 | Voice capture, consent and the session socket | Feature | #8 | 13 |
| S3.2 | The guided cockpit, unguided mode and pressure mode | Feature | #9 | 8 |
| S3.3 | Scoring, the debrief and instrument replay | Feature | #10 | 8 |

From git: 4 commits, +10,549 and -30 lines across 99 files.

### S4 Launch content

**15 to 19 Sep 2026.** The launch catalogue shipped with 25 problems and 12 voice questions, each solved by its author before release. The first corrections followed: two found by reading the rules against their own examples, and three found by timing answers read aloud.

**Why it mattered.** Content is what learners actually meet, and a rule that its own worked example breaks is a fault only careful reading finds.

**What it taught.** Timing real speech moved every voice budget by a third. The first measurement method confirmed the hypothesis suspiciously neatly and turned out to be an artefact, which a second method caught.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S4.1 | 25 problems and 12 voice questions, each solved by its author | Feature | #11 | 21 |
| S4.2 | Stop learner code reading the scripted model | Bug, found by reading | #12 | 3 |
| S4.3 | Make the budget rule in docs/04 and its own worked example agree | Bug, found by reading | #13 | 1 |
| S4.4 | Cut every voice budget by a third, to 138 words a minute | Bug, found by measuring | #14 | 2 |
| S4.5 | Check that a beat's seconds match the words spent on it | Task | #15 | 2 |
| S4.6 | Move seconds onto the beats that carry the words | Bug, found by measuring | #16 | 1 |

From git: 11 commits, +9,251 and -144 lines across 110 files.

### S5 First real use

**19 to 20 Sep 2026.** The first end-to-end run found four faults in one afternoon, the worst being that there was no authentication at all. Sign-in, the queue worker, a publishing command and an operating manual followed.

**Why it mattered.** Each of the four faults would have broken the beta on its first day.

**What it taught.** A green test suite shows the code does what the tests say, and says nothing about whether the product works. The missing sign-in had 396 passing tests around it.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S5.1 | Sign in with GitHub, so two learners are two people | Bug, found by running it | #17 | 8 |
| S5.2 | Add the worker that drains the queue | Bug, found by running it | #18 | 3 |
| S5.3 | Keep test fixtures out of the catalogue, and let local sign-in through | Bug, found by running it | #19 | 2 |
| S5.4 | Publish content with a command, and serve the twelve voice questions | Bug, found by running it | #20 | 5 |
| S5.5 | Rewrite the README as the operating manual | Task | #21 | 5 |
| S5.6 | Add a deploy route on AWS alone, with no subscriptions | Task | #22 | 2 |

From git: 6 commits, +2,722 and -83 lines across 28 files.

### S6 Evaluation panel

**21 to 22 Sep 2026.** Three evaluators give one consolidated verdict: deterministic checks, a small local model that compares an answer with graded neighbours, and the model judge. Faculty get a queue of disagreements and a way to override a grade.

**Why it mattered.** A grade a learner can appeal needs a record of which evaluator said what, and a person who can correct it.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S6.1 | Specify the evaluation panel, analytics and progress | Task | #23 | 5 |
| S6.2 | Measure panelist 2's model before writing its code | Task | #24 | 3 |
| S6.3 | Build eval/: the panel, the consolidator and the evaluation record | Feature | #25 | 8 |
| S6.4 | Wire the panel into the result writer, behind a savepoint | Feature | #26 | 3 |
| S6.5 | Build panelist 2: a band from the nearest graded answers | Feature | #27 | 8 |
| S6.6 | Refuse to start without an evaluator the catalogue requires | Feature | #28 | 3 |
| S6.7 | The faculty disagreement queue | Feature | #29 | 5 |
| S6.8 | The faculty override, with competency recomputed from it | Feature | #30 | 5 |
| S6.9 | The heuristic registry, and a notice when a grade moves | Feature | #31 | 5 |
| S6.10 | Declare complexity and interview evidence on every problem | Task | #32 | 3 |
| S6.11 | Drop the C5 complexity level that nothing could supply | Task | #33 | 1 |

From git: 11 commits, +8,211 and -172 lines across 147 files.

### S7 Install fixes

**22 to 30 Sep 2026.** The first people to set it up on their own machines hit four gaps: two missing installs, an undocumented database install on a Mac, and a test suite that deleted the development database of anyone who followed the README.

**Why it mattered.** Each of these stopped a person at the first step of using the product.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S7.1 | Install boto3 for the local judge, and test that it is there | Bug, found by running it | #34 | 1 |
| S7.2 | Install panelist 2's runtime, and name the right fix when it is missing | Bug, found by running it | #35 | 3 |
| S7.3 | Document the Postgres install on a Mac | Task | #36 | 1 |
| S7.4 | Stop the web tests wiping the development database | Bug, found by running it | #37 | 3 |

From git: 4 commits, +425 and -25 lines across 14 files.

### S8 Revamp

**30 Sep 2026.** Every problem got a coached workspace, the catalogue grew from 25 to 92 problems along a four-stage path, and the sandbox stopped holding the scripted model, the trace or any credential.

**Why it mattered.** Before it, learner code could read the answers, forge its own trace or read the runner's credentials, and a score from such a sandbox proves nothing.

**What it taught.** Mutants of each reference solution found 37 contract promises that no graded test checked. Each now fails a hidden case.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S8.1 | The problem kit: a schema, its validator and a gold-standard problem | Feature | #38 | 8 |
| S8.2 | A design system and an app shell | Feature | #38 | 8 |
| S8.3 | A coached workspace: scenario, diagram, approach map, hints and coach | Feature | #38 | 13 |
| S8.4 | Journey surfaces: home, a readiness gauge, a four-stage path and search | Feature | #38 | 8 |
| S8.5 | Grow the catalogue from 25 to 92 problems, with four capstone builds | Feature | #38 | 21 |
| S8.6 | Move the harness out of the sandbox and close the escape routes | Bug, found by reading | #38 | 13 |
| S8.7 | Every step checkable, new assertions, and hidden cases from mutants | Feature | #38 | 8 |
| S8.8 | Record a call the budget refuses, and count it as a call asked for | Bug, found by testing | #39 | 3 |

From git: 221 commits, +57,068 and -3,235 lines across 395 files.

### S9 Beta on AWS

**30 Sep 2026.** The worker now calls the runner and judge functions directly, the stack deploys from a clean AWS account, sign-in is by invite, a runbook covers the launch, and what the first beta tester hit is fixed.

**Why it mattered.** Before it, the first deploy could not succeed, and students outside the GitHub organisation could not sign in at all.

**What it taught.** The beta tester's complaint that the site was sluggish traced to every keystroke re-rendering the whole workspace. Measuring before guessing found it, and found that undo did nothing in either editor, which no test had covered.

| Story | Title | Type | Delivered in | Points |
|---|---|---|---|---|
| S9.1 | Call the runner and judge Lambdas directly from the worker | Feature | #40 | 5 |
| S9.2 | Make the stack deploy from a clean account | Bug, found by reading | #40 | 8 |
| S9.3 | Accept India's and Japan's Bedrock inference profiles | Bug, found by reading | #40 | 1 |
| S9.4 | Invite-only sign-in, the organisation check as a switch, and APP_URL | Feature | #40 | 8 |
| S9.5 | Amend the specifications and write the AWS runbook | Task | #40 | 5 |
| S9.6 | Stop browser extensions tripping the hydration check | Bug, found by beta tester | #40 | 1 |
| S9.7 | Bring undo back in both editors | Bug, found by testing | #40 | 2 |
| S9.8 | Stop re-rendering the whole workspace on every key | Bug, found by beta tester | #40 | 5 |

From git: 8 commits, +3,337 and -756 lines across 57 files.
<!-- /generated:history -->

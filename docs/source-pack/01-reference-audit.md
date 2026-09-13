# Reference audit and design decisions

Inspected 14 September 2026. Source: [AgenticPrep problem library](https://www.agenticprep.io/problems), its public navigation, and the supplied 4 minute 18 second screen recording. The recording was initially named `AgenticPrep.io.mov` and was found under the renamed file `AgenticPrep-io.mov` on the Desktop. It has video only. Inspection used 26 frames across its full duration, with enlarged views of the coding workspace and lesson flow. The recording's account details are deliberately excluded from the handoff.

## Evidence boundaries

| Evidence | What was verified | What remains unknown |
|---|---|---|
| Live public catalog, all five pagination pages | 43 visible problem entries, five topic filters, three difficulty levels, free/pro separation, status, estimates and acceptance values | Whether acceptance percentages are measured, seeded or editorial; no percentage is reused as an Academy statistic |
| Live public problem page | Statement and a read-only starter preview for the first loop exercise | Actual backend, grading implementation and hidden tests |
| Recording, approximately 0:25–0:45 | Two-column statement and starter layout before sign-in | Runtime internals |
| Recording, approximately 1:25 | Paid exercise preview and access limitation | Protected solution content |
| Recording, approximately 2:15–2:45 | Signed-in problem/submission/solution tabs, Python 3.12 label, editable-looking code pane, reset/run/submit, incremental hints, a solution gate and run feedback | No independent execution against the source service was performed |
| Recording, approximately 3:05–3:25 | Lesson, coding practice, checklist and learning-objective arrangement | Full content of every lesson |
| Live learning path | A 30-day sequence with four phases and linked practice | Does not establish an appropriate Academy timetable |
| Live interview section | 55 questions across 12 topics, with answers, examples and mistake notes | Site labels do not establish actual employer interview frequency |
| Live CSS through the rendered page | Body and heading font stack starts with Geist, followed by Inter and system sans | Exact font licensing and assets should be checked when bundling fonts |

[Learning path](https://www.agenticprep.io/learning-paths/agentic-ai-interview-prep) · [Curriculum](https://www.agenticprep.io/curriculum) · [Interview section](https://www.agenticprep.io/interview-questions).

## Preserve, change, add

| Reference pattern | Academy treatment | Reason |
|---|---|---|
| Dark background, restrained borders, Geist typography, compact metadata | Preserve the visual character with original Academy identity and assets | Familiar developer workspace with little visual noise |
| Searchable table and topic/difficulty filters | Add domain, task format and personal status; preserve table density | Learners can find all content independently of their roadmap |
| Split problem and code view | Add prompt/config/test files and a trace/results drawer | AI engineering involves more than a Python function |
| Run and submit distinction | Run public checks; submit an immutable version for trusted evaluation | Practice feedback and assessment evidence have different meanings |
| Progressive hints | Explicit difficulty contract, with no instructional guidance in Extreme | Guidance must be predictable across authors |
| Solution gate | Practice solution available after a real attempt or explicit reveal; mark assisted exposure | Clicking Run on untouched code must not count as mastery |
| Daily lesson/checklist | Flexible milestone roadmap, tied to the Academy timetable later | A new platform must not silently add a 30-day programme commitment |
| Interview answers | Require an answer first, then reveal a rubric and counter-question | Prevent recognition from being mistaken for interview readiness |
| Free/pro and pricing | Remove entirely, including database entitlements and API checks | All cohort members have the same problem access |
| Acceptance percentage | Replace with personal evidence state; optional anonymized cohort metric later | Do not import unexplained statistics or rank personas |
| Missing operational controls in inspected screens | Add cohort assignments, support queue, content versioning and cost controls | Needed to operate a 200-person cohort |

## What “clone” means in this handoff

Reproduce useful interaction patterns and topic coverage in an original FDE Academy product. The catalog maps every visible reference problem to an original equivalent and adds 77 further briefs. Exact third-party statements, editorial answers, branded assets and hidden tests are not shipped. An authorized export can later enter a controlled import pipeline with provenance and version tracking. Public metadata collection does not establish permission to republish protected material.

The product also corrects weak teaching defaults: exact trace ordering is used only when the task requires that order; prompt-injection keyword matching is taught as a limited baseline rather than a complete defense; provider-private reasoning is not required or presented as an observable truth. Agent traces contain actions, observations, policy outcomes and concise explicit explanations.

## FDE grounding

A current [OpenAI FDE role description](https://openai.com/careers/forward-deployed-engineer-tokyo-tokyo-japan/) emphasizes discovery, scoping, building, deployment, customer collaboration and measurable impact. This supports including delivery and judgment exercises alongside coding. It does **not** verify that any exercise here was used in that employer's interview. All questions in this pack are labeled interview-style unless future permission-backed evidence establishes otherwise.

Earlier Academy notes identify Builder, Navigator and Accelerator as support personas, distinct from project pods. That distinction is retained; the starting-level mappings in this pack are proposals awaiting the current Academy persona definitions.

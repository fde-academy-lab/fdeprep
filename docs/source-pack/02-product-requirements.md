# FDE Academy Practice Lab: product requirements

Version 0.1 · 14 September 2026 · Build specification, not a deployed application.

## 1. Product decision

Create an internal practice and technical-screening environment for 150–200 FDE Academy learners. Combine Generative AI, Agentic AI and FDE delivery challenges in one library. Every learner can open every published problem. Builder, Navigator and Accelerator change recommendations and support, never content entitlements.

The core experience is: understand a small client need, edit an artifact, run visible checks, investigate a failure, submit against held-out cases, explain the decision, and later solve a transfer variation independently. Success means demonstrated capability, not lessons clicked or code copied.

Working name: **FDE Academy Practice Lab**. Use FDE Academy text branding until approved brand assets exist. Dark-first appearance, Geist body and headings, Geist Mono for code and compact metadata. Light mode and system mode are required in the implementation.

## 2. Scope and delivery boundary

This pack supplies an interactive wireframe, requirements, architecture, a 120-item authoring catalog, eight detailed exercise specifications, executable deterministic examples, an original interview bank, deployment planning and build prompts. The catalog contains 63 Agentic AI, 32 Generative AI and 25 FDE Practice briefs. The 43 reference-equivalent items are individually mapped to source URLs.

A catalog brief is not a publishable problem. Production launch requires the authoring gate below. The MVP should launch with **24 reviewed challenges**, then expand to 60 and finally 120. The full planned library remains represented in the content pipeline; never show unfinished briefs as solvable tasks. The initial 24 should include the eight exemplars, balanced GenAI/agent basics and a small number of delivery cases. Do not claim all 43 equivalents are available until all 43 pass content QA.

Included in MVP: invited cohort access, all-problems browser, three recommended roadmaps, Python and prompt-edit workspaces, public runs, held-out submissions, deterministic grading, controlled live prompt evaluation, hints by difficulty, attempt history, manual review, one technical-screen template, instructor cohort view and operational budget controls.

Later: TypeScript exercises, multi-file integration projects, browser-agent labs, advanced multi-agent tasks, SSO beyond the initial provider, collaborative sessions and richer LMS integration. Do not add payments, subscription tiers, a social feed, a public leaderboard, unrestricted internet access from learner code or a general-purpose autonomous tutor.

## 3. Users, roles and permissions

| Role or attribute | Behavior |
|---|---|
| Learner | Read every published problem; edit own drafts; run/submit; see own detailed evidence and assigned assessments |
| Instructor | Learner access plus cohort-scoped progress, manual rubric review, support triage and assignment creation |
| Content author | Draft/version problem packages and run content QA; cannot see unrelated private learner submissions |
| Administrator | Invite/deactivate members; assign instructor scope; set budgets, publish approved packages, review audits |
| Persona | Recommendation attribute only; learner can preview another roadmap and request or choose a different recommendation |
| Pod | Optional dynamic peer/project grouping; independent of persona and authorization |

Use explicit cohort membership with an active state. Authentication alone does not admit a learner. A user with two cohorts sees only authorized records for the chosen cohort. Persona labels are private by default. Instructor visibility must be intentional; do not publicly identify struggling learners.

## 4. Guidance contract

Difficulty describes independent complexity, not just the number of lines of code. A problem has one canonical difficulty. Guided variants and harder transfer problems have separate IDs or versioned variants, so scores are not mixed.

| Level | Provided before attempt | Permitted help during practice | Learner responsibility |
|---|---|---|---|
| Easy | One small worked example using different data, explicit goal, input/output example, ordered checklist, marked editable slots or TODOs, visible boundary tests | Three authored hint levels: concept, location, partial example; clear error categories and a next-step suggestion | Complete the focused operation and explain one reason |
| Medium | Short context, exact contract, partial implementation, a few examples and visible tests | Optional concept hints; diagnosis without a worked solution | Choose the implementation and add an edge case |
| Hard | Client constraint, interfaces, minimal scaffolding, public smoke checks and deliverables | Error facts and environment documentation only; no step plan, algorithm hint or code completion | Decompose the task, implement, test and defend trade-offs |
| Extreme | Client brief, available fixtures/APIs, constraints, deliverables, evaluation dimensions and time limit if assessed | No hints, tutor, solution suggestions, decomposition or recommended sequence during the attempt | Independently scope, design, build, evaluate and explain the result |

Extreme still provides a usable environment and unambiguous submission interface. Removing instructions needed to use the platform does not make a task meaningfully harder. A learner can leave an Extreme attempt and practice related easier problems; the independent attempt remains separately recorded. Post-submission debrief is available after closure, not during an active assessment.

Changing persona never changes an existing exercise's guidance or evaluation thresholds. An Easy problem remains guided for an Accelerator; an Extreme problem remains unguided for a Builder.

## 5. Proposed persona roadmaps

These are support recommendations, not statements about current Academy definitions. A 25–35 minute diagnostic samples Python/data contracts, prompt behavior, evidence, debugging and technical explanation. Use per-skill evidence; do not collapse a learner into one permanent ability score. Learners and instructors can override placement with a recorded reason.

| Persona | Recommended start | Early sequence | How it progresses |
|---|---|---|---|
| Builder | Guided GenAI foundations plus coding/data prerequisites | G004 → G001 → G002 → G003 → G008 → A044 → A001 → A004 → A006 → A008 | Add medium transfer after successful public and held-out checks plus an explanation; keep prerequisite repair available |
| Navigator | A thin end-to-end workflow and targeted gap repair | G009 → G014 → A008 → A021 → A022 → A017 → A025 → F010 → F011 | Use diagnostic gaps to insert Easy practice; progress toward integration, evaluation and delivery decisions |
| Accelerator | Baseline challenge, failure analysis and constrained delivery | A029 → G021 → A054 → A057 → F016 → F017 → A060 → F023 | Start at Hard where prerequisites are evidenced; move to Extreme engagements and technical defense |

Prerequisites are recommended, not locks. If diagnostic evidence is missing, show “You may want to practice X first” and a direct link. Never automatically present a hard roadmap as proof of mastery. All three roadmaps converge on grounded output, reliable execution, safety, evaluation and client delivery.

Within each milestone use a connected fictional support-service scenario, **Northstar Service Desk**: policy documents, support tickets, an order-status API, escalation rules and a synthetic customer directory. Early tasks introduce one failure at a time. Later tasks reuse the same fixtures and combine constraints. A second fictional scenario, **Harbor Equipment**, tests transfer through maintenance tickets and parts inventory. Neither scenario contains real customer data.

Proposed evidence states: not started; in progress; passed with support; independently demonstrated; needs review. “Independently demonstrated” requires an unassisted transfer attempt after solution exposure, not merely a later resubmission of the same task. Minimum spacing and exercise equivalence are instructor settings, initially a different variant in a later session. These are platform evidence labels, not automatic certification decisions.

## 6. Information architecture

Top navigation: **My roadmap / All problems / Learn / Interview studio / My progress**. Instructors and administrators additionally see **Cohort**. No pricing or upgrade action anywhere.

Routes: `/home`, `/roadmaps/:persona`, `/problems`, `/problems/:id`, `/learn/:concept`, `/interview`, `/progress`, `/assessments/:id`, `/cohort`, `/cohort/content`, `/settings`.

### My roadmap

Display current milestone, why it is recommended, one next task, prerequisites with evidence, estimated effort and a progress checklist. Show a persistent “Browse all problems” link. A roadmap is milestone-based; assignment dates can align it with the actual cohort timetable later. Do not impose a new 30-day curriculum.

### All problems

A searchable table with ID/title, domain/topic, difficulty, task format, personal evidence state and estimated effort. Search matches title, tags, concepts and IDs. Filters compose and survive navigation via query parameters. Include clear filter reset and an informative zero-results state. Default sort is recommended-first, with explicit title/difficulty/recent options. Do not conceal other problems when a persona is selected. Source-derived topics are available under original Academy titles.

### Learn

Short concept pages containing a mental model, one example, a failure example, a decision rule and links to practice. Learners may jump directly to practice. Reading checkmarks indicate reading only. Content authors pair concepts with exercises and recall questions.

### Problem workspace

Desktop: brief on the left at approximately 38%, editor on the right at approximately 62%, results dock below the editor. Panels resize using mouse and keyboard. The statement, editors and results scroll independently while the task title and Run/Submit actions remain reachable. Fullscreen editor and focus mode are available.

Left tabs: Brief, Guidance when permitted, History, Review. Right file tabs: `solution.py`, `system_prompt.md`, `config.json`, `tests.py`, and Preview when the challenge needs them. Show only relevant files. The browser is the integrated workspace; AgentCore Browser is an optional future remote browser for automation exercises, not a dependency of the code editor.

Editing modes: implement a function; fill specified spans; repair existing code; remove a word/clause; modify a prompt; edit a schema/configuration; author tests; inspect a trace; or build from a client brief. Read-only fixtures are visually distinct. UI locks improve guidance, but the server must also validate allowed edits by comparing the submitted artifact with the immutable template.

Run executes public cases without awarding mastery. Submit saves an immutable artifact snapshot and starts trusted evaluation. Both show the exact draft version they used. If the learner edits while a job runs, show “Results are for the previous version.” Reset shows a diff and preserves a recoverable draft version. Autosave displays saving/saved/offline/conflict states; a reload must not lose an acknowledged save.

Results tabs: Public tests, Submission result, Trace, Output, Cost. Each failed public test shows input, expected and actual values where safe, plus a clear difference. Hidden feedback shows a failure family and actionable constraint, not fixtures, expected output, grader code or a solution. Learner stdout is displayed as untrusted text and never interpreted as a trusted grading verdict.

Trace shows explicit actions, tool arguments after redaction, observations, timing, policy decisions and termination. Do not require or invent model-private chain-of-thought. A prompt editor supports version history and side-by-side diffs. Preview renders only sanitized output on a separate sandboxed origin; it never runs learner HTML in the Academy application origin.

### Interview studio

Three modes: explain a concept in 90 seconds; repair-and-explain in 25–40 minutes; client work sample in 60–120 minutes. These are product defaults, not verified employer formats. Learners answer before seeing review material. Follow-up questions change a real constraint rather than demand memorized definitions. Text entry is sufficient for MVP; audio recording is optional later and requires a clear retention choice.

### My progress

Show evidence by skill, assistance used, repeated failure categories, recent independent transfer and recommended repair. Display “insufficient evidence” when samples are missing. Do not show invented readiness percentages or compare unlike variants. Export an evidence portfolio with the learner's artifacts, versions, evaluation context and reflection, subject to assessment release rules.

### Cohort

Roster import preview, duplicate/error report, persona recommendation and override, assignments, completion by skill, learner support queue, grading backlog, job health and spend. An instructor can see “18 learners fail approval expiry” and assign a repair exercise. A learner row opens evidence, not a public rank. Cost and grading errors are separate from learning difficulties. Changes to membership, rubrics, budgets and publication are audited.

## 7. Assessment behavior

Practice and assessment are separate modes with server-enforced policies. A technical screen has a versioned definition: problem versions, start/end window, duration, accommodations, allowed documentation, allowed AI assistance, max submissions, rubric, release time and reviewer. Recommended default: AI assistance allowed in practice according to guidance; assessment assistance is explicitly selected by the instructor and displayed before start.

One server-generated deadline governs submission. Persist drafts continuously. Connection loss does not extend time automatically; instructors can grant a recorded extension. Do not rely on browser timers for enforcement. An infrastructure outage yields `infrastructure_error` or a paused assessment, never an incorrect answer. Submission at the deadline is accepted or rejected atomically using server time. Regrades retain the old result and record the new evaluator version.

All published practice problems remain open to everyone. Timed assessments can use unpublished equivalent variants; this protects a specific screening event without turning persona into an access tier. No browser feature can guarantee that a learner does not use a second device. Use transparent assistance rules and an oral technical defense rather than claiming cheat-proof proctoring. Similarity signals are review cues, not automatic misconduct findings.

## 8. Grading and guidance integrity

Use deterministic checks for schema, exact edits, numeric limits, state transitions, authorized effects, source membership and test behavior. Use live models only for behavior that requires generation. Prompt presence alone does not prove prompt effectiveness. A deletion-only task can have a deterministic edit gate and a separate live behavior evaluation.

Each challenge publishes its pass rule. Proposed coding rule: all mandatory correctness and safety invariants pass, plus at least 80% of noncritical weighted cases. Safety failures cannot be compensated by a good average. A semantic score cannot override deterministic failure. Design and communication work uses a disclosed rubric and manual review; model feedback is advisory until calibrated.

Live evaluation records model/provider identifier, region or inference route, prompt version, evaluator version, case set, sampling parameters where supported, trial count, usage and timestamp. Repeat critical cases and show variability. A temperature of zero is not a promise of determinism. Pilot each live exercise against strong, weak and adversarial solutions before setting thresholds. Mark it provisional until a reviewer approves calibration.

The tutor, if added later, is never given hidden tests or reference solutions. Authored hints are the MVP default. Safety and assistance restrictions are enforced on the server, not through prompt text alone.

## 9. Content package and publication gate

Every publishable problem contains: stable ID; domain; topic; prerequisites; canonical difficulty; editing mode; learner brief; allowed files/edits; runnable environment contract; public examples; visible test cases; boundary tests; adversarial cases; hidden test inputs and a separate trusted oracle; reference solution in instructor storage; level-appropriate hints; rubric and pass rule; estimated time; screening relevance label; source provenance; version; author; reviewer; accessibility notes.

Publication sequence: draft → technical QA → pedagogical QA → pilot → published → deprecated. An automated gate validates schema and references, runs the correct solution, proves the starter fails the intended task, exercises known incorrect mutations, checks output redaction and confirms no protected material enters the learner bundle. A human reviewer checks ambiguity, valid alternative solutions, language and calibration. A learner attempt remains pinned to its published version after an update.

For test-authoring tasks, evaluate whether learner tests detect predefined faulty implementations and accept the correct one. Never award points merely for the number of tests. Keep mutation implementations outside the learner environment and release only safe aggregate feedback.

## 10. Acceptance criteria

| ID | Observable acceptance condition |
|---|---|
| AC01 | Builder, Navigator and Accelerator can each open the same published Extreme problem; recommendation order differs |
| AC02 | No pricing page, subscription entitlement or upgrade check exists in UI or API |
| AC03 | Easy exposes ordered guidance; Medium only authored optional hints; Hard has no solution guidance; Extreme has no hint/tutor endpoint access |
| AC04 | Edited code, prompt and config survive reload after a saved acknowledgment; concurrent-tab conflict is surfaced |
| AC05 | A duplicate Submit request creates one attempt and at most one billable logical evaluation |
| AC06 | Public Run reveals only public fixtures; held-out feedback does not leak expected output, grader source or secret cases |
| AC07 | Learner code cannot access another learner's files, platform tables, model credentials or assessment oracle |
| AC08 | A fake stdout message saying PASS cannot alter the trusted grade |
| AC09 | A deleted word task rejects unrelated edits even when the browser editor is bypassed |
| AC10 | Timed-screen deadlines, accommodations and assistance rules are enforced server-side |
| AC11 | A stale model response or old job cannot overwrite a newer attempt result |
| AC12 | Instructor support view distinguishes failed tests from infrastructure faults and budget pauses |
| AC13 | In the pilot load test, 200 signed-in clients can navigate and save while 200 short submissions queue safely; targets are measured in the deployment plan |
| AC14 | An external network attempt, metadata read and role-permission probe cannot reach privileged platform resources from a learner sandbox |
| AC15 | Browser Back restores filters; keyboard users can reach and resize the editor; 200% zoom does not hide Run/Submit |
| AC16 | An observed solution is recorded as assisted exposure; an independent mastery label requires a separate unassisted transfer exercise |
| AC17 | Every source catalog slug has a unique Academy mapping; publication status is truthful |
| AC18 | A model-usage reservation prevents concurrent branches overspending one run budget; reconciliation releases unused allowance |

## 11. Success measures and decision points

Primary: rate of independent transfer completion within each skill, with sample size. Supporting: failure repair after feedback, completion of actual runnable artifacts, reviewer agreement, time to first useful feedback, instructor support load and cost per active learner. Segment by prior evidence and assistance; do not use persona as a public league table. Set numeric learning targets after the first pilot, not before baseline evidence exists.

Decisions still to confirm: official persona definitions and curriculum alignment; approved branding; exact-content reuse permission; cohort identity provider; region/data residency; monthly budget ceiling; assessment stakes; whether Python-first meets the first cohort's needs. Current working assumptions are recorded in the deployment plan. These do not block building the local shell and deterministic runner contract.

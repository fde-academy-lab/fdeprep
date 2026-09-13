# FDE Academy problem catalog

120 original authoring briefs: 43 reference equivalents and 77 additions. This is a scoped content backlog, not a claim that 120 runnable, calibrated exercises exist. Every row needs the authoring acceptance gate in the PRD. Suggested times are estimates. Source links identify topic coverage, not licensed imports.

## Generative AI

| ID | Difficulty | Academy exercise | What the learner must demonstrate | Adversarial variation |
|---|---|---|---|---|
| G001 | Easy | Complete an evidence-only system prompt | Fill policy slots for sources, abstention and output shape. | Source text asks the model to ignore the policy. |
| G002 | Easy | Remove one unsafe promise | Delete only the word always from a specified policy clause. | Other occurrences of always in examples must remain unchanged. |
| G003 | Easy | Repair an invalid JSON response | Return a schema-valid object without invented fields. | Markdown fences, trailing commas and missing required keys. |
| G004 | Easy | Separate instructions from customer text | Build a typed message envelope that labels untrusted data. | Customer text contains fake system-role delimiters. |
| G005 | Easy | Fit a response inside a token allowance | Allocate input and output budgets using a supplied tokenizer. | Multilingual text uses more tokens than a character heuristic predicts. |
| G006 | Easy | Choose examples that teach the boundary | Select representative few-shot examples from a labeled set. | All selected examples belong to one class. |
| G007 | Easy | Extract a support ticket without guessing | Populate typed fields and mark unknown values explicitly. | Customer text contradicts itself about an order ID. |
| G008 | Easy | Add the missing boundary test | Write a test for the empty-evidence path. | Only the happy path has been tested. |
| G009 | Medium | Repair a contradictory system prompt | Resolve competing rules while preserving valid obligations. | A later broad instruction overrides a required restriction. |
| G010 | Medium | Compress a prompt without losing a constraint | Reduce a prompt under a stated budget and preserve behavior. | A negative constraint is lost during shortening. |
| G011 | Medium | Validate and repair output once | Add one bounded repair attempt with explicit failure status. | The repair response is also invalid. |
| G012 | Medium | Handle conflicting evidence fields | Return a conflict state with source references. | The most recent document is less authoritative. |
| G013 | Medium | Reject unsupported answer claims | Associate each generated factual claim with evidence. | Citation exists but does not support the associated claim. |
| G014 | Medium | Compare two prompts on paired cases | Compute paired improvements and regressions by slice. | Overall accuracy rises while the rare critical slice worsens. |
| G015 | Medium | Make a model judge resist answer instructions | Delimit candidate content and validate the judge output. | Candidate answer includes a forged evaluator instruction. |
| G016 | Medium | Recover from a partial streamed object | Buffer partial data and display a recoverable interrupted state. | Connection breaks midway through a quoted string. |
| G017 | Medium | Redact synthetic PII before inference | Apply documented field rules before model invocation. | PII appears in nested metadata and a quoted log. |
| G018 | Medium | Cache only equivalent authorized requests | Build a cache key with tenant, policy and model versions. | Identical text from different tenants. |
| G019 | Medium | Use a cheaper model after measured evidence | Route cases using published measured capability thresholds. | Cheap model passes averages but fails a required language slice. |
| G020 | Medium | Distinguish refusal from missing evidence | Return explicit cannot-answer and policy-refusal states. | A safe but unsupported question is mistaken for a prohibited one. |
| G021 | Hard | Calibrate a semantic evaluator with human labels | Measure agreement and tune a documented threshold. | A judge systematically favors verbose wrong answers. |
| G022 | Hard | Diagnose conflicting context at generation time | Trace context selection and answer claims before proposing a fix. | The correct evidence was retrieved but removed by the context budget. |
| G023 | Hard | Preserve policy across multilingual inputs | Evaluate the same contract across supplied language cases. | Translated injection and mixed-script instructions. |
| G024 | Hard | Ship a prompt change with a rollback rule | Version prompts and compare on holdout slices before promotion. | An improvement on development cases regresses the holdout. |
| G025 | Hard | Design a holdout that does not leak | Split related cases by source and template family. | Near-duplicate examples cross the development and holdout boundary. |
| G026 | Hard | Choose RAG or fine-tuning for a client brief | Compare evidence, update rate and measured failure patterns. | A memorization problem is mislabeled as missing knowledge. |
| G027 | Hard | Validate extracted table evidence | Reconcile a supplied image-derived table with row provenance. | Merged cells and a misplaced decimal change the answer. |
| G028 | Hard | Detect a poisoned document before answer generation | Evaluate boundary controls and downstream behavior on injected sources. | Obfuscated instructions coexist with useful evidence. |
| G029 | Extreme | Build an evidence-grounded support copilot | Deliver an evaluated solution from a client brief and fixtures. | Conflicting policies, outages, injection and a strict operating budget. |
| G030 | Extreme | Rescue a failing document extraction pilot | Diagnose evidence, implement a repair and justify rollout. | Training examples hide the most expensive failure segment. |
| G031 | Extreme | Reduce model spend without breaking the service | Propose and implement a measured cost reduction under quality constraints. | Caching creates tenant leakage and routing harms critical cases. |
| G032 | Extreme | Rebuild a brittle prompt workflow | Deliver a maintainable workflow with documented limits and holdout evidence. | The incumbent prompt contains competing undocumented rules. |

## FDE Practice

| ID | Difficulty | Academy exercise | What the learner must demonstrate | Adversarial variation |
|---|---|---|---|---|
| F001 | Easy | Turn a vague request into a testable outcome | Write a measurable workflow goal and a non-goal. | The stated metric measures activity rather than customer value. |
| F002 | Easy | Validate a customer API payload | Repair a typed adapter against a provided contract. | Missing field, unexpected enum and a null nested object. |
| F003 | Easy | Choose the smallest useful vertical slice | Select one usable path connecting UI, service and evidence. | A polished dashboard hides a non-working core action. |
| F004 | Easy | Add a useful error to a broken integration | Return a safe error and a trace correlation ID. | Raw provider error exposes an internal credential. |
| F005 | Easy | Calculate cost per successful task | Compute spend divided by completed useful outcomes. | Retries and failed tasks were excluded from total spend. |
| F006 | Medium | Challenge an unrealistic automation target | Translate a client target into measurable assumptions and a pilot. | Accuracy target ignores the cost of rare failures. |
| F007 | Medium | Repair a webhook without duplicate work | Implement idempotency and safe acknowledgement. | Provider retries while the first delivery is still processing. |
| F008 | Medium | Recover from an API schema change | Add compatible parsing and version-aware errors. | A field changes units while keeping its old name. |
| F009 | Medium | Set a release threshold from evidence | Choose metrics and critical-slice requirements from supplied results. | High average success conceals unauthorized actions. |
| F010 | Medium | Explain a trade-off to a client engineer | Write a concise decision record with consequences and evidence. | The preferred option lacks an operational owner. |
| F011 | Medium | Convert a notebook into a service contract | Define inputs, errors, versioning and observable behavior. | Notebook state silently affects the second request. |
| F012 | Medium | Keep tenant scope through the whole request | Propagate verified tenant identity across adapters. | A user-supplied tenant ID overrides the authenticated scope. |
| F013 | Medium | Triage a delayed cohort job | Use queue and trace evidence to distinguish causes. | Infrastructure failure is reported as a learner mistake. |
| F014 | Medium | Prioritize a pilot backlog by evidence | Rank work by impact, effort and validated uncertainty. | A senior request has no evidence of customer impact. |
| F015 | Medium | Write an honest production handoff | Document service limits, rollback and ownership. | A critical dependency is owned by nobody. |
| F016 | Hard | Roll back an unsafe model change | Design a canary and rollback decision from segmented metrics. | Rollback restores code but leaves the new prompt version active. |
| F017 | Hard | Design an idempotent side-effect boundary | Make repeated action delivery safe with a durable ledger. | Worker crashes after external success but before local acknowledgement. |
| F018 | Hard | Handle a customer environment with no outbound internet | Select a feasible inference and artifact distribution plan. | The proposed package installer needs blocked internet access. |
| F019 | Hard | Prove whether a pilot is worth expanding | Analyze adoption, quality, cost and operating effort together. | User satisfaction improves while manual correction work doubles. |
| F020 | Hard | Design deletion across derived AI artifacts | Propagate deletion into caches, indexes and summaries. | An old summary reintroduces a deleted fact. |
| F021 | Hard | Investigate an incident from incomplete telemetry | State evidence, hypotheses, containment and next checks. | Missing spans tempt the engineer to claim an unobserved cause. |
| F022 | Extreme | Deliver a Client Zero engagement | Scope, build, evaluate and hand over a simulated client solution. | Requirements change after a credible prototype exists. |
| F023 | Extreme | Repair a brownfield AI service under constraints | Ship a minimal repair with regression and rollback evidence. | No clean rewrite is possible and the legacy contract must remain stable. |
| F024 | Extreme | Defend a build in a technical screen | Demonstrate working behavior and answer a surprise constraint. | The interviewer removes the assumption the design depends on. |
| F025 | Extreme | Run an incident and recovery exercise | Diagnose, contain, repair and brief stakeholders from fixtures. | The first apparent fix improves latency but breaches a policy. |

## Agentic AI

| ID | Difficulty | Academy exercise | What the learner must demonstrate | Adversarial variation |
|---|---|---|---|---|
| A001 | Easy | Finish a bounded support loop | Implement action/observation transitions and validated completion. | Malformed completion and a model that never terminates. |
| A002 | Easy | Dispatch only registered actions | Route a structured action to an allowlisted handler. | Unknown tool and malicious argument expression. |
| A003 | Medium | Turn a tool failure into usable state | Translate tool exceptions into typed observations without losing progress. | Timeout followed by a successful independent action. |
| A004 | Easy | Stop before the seventh action | Enforce a six-action ceiling with an explicit terminal status. | No final response at the budget boundary. |
| A005 | Medium | Compact state without losing the current task | Compress older observations and preserve active constraints. | Summary drops a required approval or unresolved question. |
| A006 | Easy | Publish a callable tool contract | Derive a JSON schema for a supported Python signature. | Unsupported annotation must fail clearly. |
| A007 | Easy | Separate missing and nullable parameters | Translate supported annotations and defaults into parameter metadata. | Optional value with no default versus default None. |
| A008 | Medium | Reject invalid action arguments | Validate shape, types, ranges and extra fields before dispatch. | Boolean accepted accidentally as an integer. |
| A009 | Medium | Collect parallel results without losing identity | Preserve call IDs and deterministic presentation order. | Duplicate tool names with different call IDs and one failure. |
| A010 | Medium | Give every observation a stable envelope | Normalize strings, objects and errors into a typed result envelope. | Nested exception text contains a synthetic credential. |
| A011 | Medium | Fit recent turns around a pinned policy | Keep complete recent turns inside a context budget. | Pinned policy alone exceeds the budget. |
| A012 | Medium | Carry unresolved work across compaction | Summarize removed turns while retaining provenance and open issues. | An unresolved issue exists only in the oldest turn. |
| A013 | Medium | Reconcile customer facts by trust and recency | Resolve duplicate and conflicting records with explicit source rank. | A newer untrusted record contradicts a verified record. |
| A014 | Medium | Protect task constraints during eviction | Evict low-priority context without losing active obligations. | All remaining records are mandatory and cannot fit. |
| A015 | Medium | Choose useful evidence without repetition | Rerank candidates using relevance and source diversity. | Top results duplicate one paragraph and omit the answer. |
| A016 | Medium | Keep an answer intact across chunk boundaries | Split documents with stable source offsets and controlled overlap. | The answer straddles two paragraphs at a size boundary. |
| A017 | Medium | Attach a source to each evidence block | Build bounded context with stable citation IDs. | Repeated source names and a truncated chunk. |
| A018 | Easy | Abstain when evidence is too weak | Apply a published evidence threshold and empty-result policy. | No result reaches the threshold. |
| A019 | Easy | Normalize answers without accepting leakage | Apply documented normalization while rejecting internal artifacts. | Correct answer wrapped in a leaked tool transcript. |
| A020 | Medium | Score outcome and behavior separately | Compute rubric dimensions and retain failure reasons. | A correct answer follows an unauthorized action. |
| A021 | Hard | Execute a dependent action plan | Resolve dependencies and carry typed outputs between steps. | A failed prerequisite blocks only its dependents. |
| A022 | Hard | Bind approval to an exact action | Require approval for a specific action version, actor and expiry. | Arguments change after approval is granted. |
| A023 | Medium | Choose a model within hard constraints | Select from supplied cost, quality and latency metadata. | No candidate satisfies all constraints. |
| A024 | Hard | Coordinate workers with one global budget | Schedule capable workers while honoring dependencies and quotas. | One worker consumes the budget needed by another. |
| A025 | Hard | Answer from evidence through a guarded workflow | Combine authorized retrieval, bounded tools and supported answers. | A retrieved document tells the agent to reveal another tenant's data. |
| A026 | Hard | Integrate a deployable agent control loop | Compose planning, state, permissions, execution and auditable results. | Cancellation arrives between approval and tool execution. |
| A027 | Medium | Check action policy before execution | Enforce allowlists and explicit constraints outside the model. | Blocked request hidden in nested JSON; benign quoted attack text. |
| A028 | Medium | Record a redacted execution timeline | Create stable correlated events with durations and terminal status. | Secrets and unbounded payloads in error messages. |
| A029 | Hard | Locate the first failing transition | Detect repetition, invalid state and latency bottlenecks. | Later errors distract from an earlier broken prerequisite. |
| A030 | Hard | Retry a transient failure within a deadline | Apply bounded exponential delay, jitter and a total deadline. | Next backoff would exceed the remaining deadline. |
| A031 | Hard | Switch tools only when policy permits | Classify failures and apply safe retry or fallback rules. | Authentication failure must not trigger a broader-privilege fallback. |
| A032 | Medium | Build a source-preserving research workflow | Compose search, extraction and synthesis with partial results. | Extraction succeeds for only one of three sources. |
| A033 | Hard | Retrieve memories with stable ranking | Select relevant authorized memories with deterministic ties. | Equally ranked records from different tenants. |
| A034 | Hard | Expire context without abandoning active work | Apply expiry rules and preserve live task dependencies. | A pinned but legally deleted record must not survive. |
| A035 | Hard | Resolve a follow-up without changing intent | Rewrite an ambiguous query using authorized conversation context. | The prior turn refers to a different customer or product. |
| A036 | Hard | Deliver a grounded support answer end to end | Rewrite, retrieve, cite and abstain with explicit evidence checks. | Conflicting policy versions and insufficient evidence. |
| A037 | Hard | Fuse lexical and semantic rankings | Deduplicate and rank two result lists by a published fusion rule. | Missing ranks, duplicate IDs and deterministic ties. |
| A038 | Hard | Evaluate instruction-boundary failures | Build a labeled evaluator for attempted instruction overrides. | Quoted security training text versus an active override attempt. |
| A039 | Hard | Check trace invariants across valid paths | Evaluate required precedence and forbidden events rather than one exact path. | Two valid tool orders should both pass. |
| A040 | Medium | Report variability across repeated trials | Aggregate per-case trial outcomes and show unstable slices. | Missing trials and a best-of-run result that hides failures. |
| A041 | Medium | Explain failure categories without exposing answers | Generate useful category-level feedback from trusted evaluator records. | A hidden input contains text asking to print the expected answer. |
| A042 | Hard | Review a proposal against delivery constraints | Score architecture decisions against an explicit client brief. | Technically elegant design violates budget or operating ownership. |
| A043 | Hard | Prioritize repairs from config and trace evidence | Combine observed failures into a ranked remediation plan. | A plausible hypothesis contradicts recorded events. |
| A044 | Easy | Separate actions from final answers | Validate a tagged action-or-final union. | Response contains both variants. |
| A045 | Easy | Remove an overpowered tool | Replace a broad shell-like capability with a narrow function. | Tool arguments try to reintroduce arbitrary execution. |
| A046 | Easy | Preserve tool-call identity | Match each result to its request ID. | Results arrive out of order. |
| A047 | Medium | Cancel an agent without executing another action | Check cancellation at every execution boundary. | Cancellation arrives after planning but before dispatch. |
| A048 | Medium | Give one request a safe tool capability | Scope access to one action, run and expiration. | A stale capability is replayed in another run. |
| A049 | Medium | Resume from a versioned checkpoint | Recover state while avoiding repeated completed effects. | Checkpoint predates a successful side effect. |
| A050 | Medium | Validate an MCP tool result | Handle structured content and error states through an adapter. | A tool result embeds an instruction as metadata. |
| A051 | Medium | Mock a tool for reproducible evaluation | Record and replay a versioned deterministic response fixture. | Recorded output belongs to another schema version. |
| A052 | Medium | Choose a workflow before adding another agent | Implement a state machine for a fixed dependency graph. | Unnecessary agent routing adds variable behavior. |
| A053 | Hard | Reject stale approval after a plan changes | Bind approval to an immutable action digest. | Same tool name with a different destination. |
| A054 | Hard | Recover a partially completed plan | Resume only safe incomplete steps. | One completed step is non-idempotent. |
| A055 | Hard | Prevent data crossing worker boundaries | Scope task context and tools by worker capability. | One worker requests another tenant's memory. |
| A056 | Hard | Find a useful attack that breaks a naive agent | Author an adversarial case with an expected safe outcome. | An attack test also rejects harmless quoted text. |
| A057 | Hard | Enforce one budget across concurrent branches | Use atomic reservations and reconciliation. | Two branches each observe the same remaining budget. |
| A058 | Hard | Replay an agent failure from recorded evidence | Reconstruct actions with versioned fixtures and compare invariants. | Tool schema drift makes an old trace incompatible. |
| A059 | Hard | Quarantine an untrusted tool response | Validate output and allow only declared downstream use. | A response contains a URL designed to trigger data export. |
| A060 | Extreme | Build an approved-action service agent | Deliver a constrained agent with an auditable effect boundary. | Duplicate requests, revoked approval and a dependency outage. |
| A061 | Extreme | Coordinate a multi-worker investigation | Solve a client incident using bounded specialized workers. | Workers disagree, repeat evidence and compete for the budget. |
| A062 | Extreme | Replace a fragile autonomous workflow | Choose the appropriate control model and prove the improvement. | The best solution may use fewer autonomous steps. |
| A063 | Extreme | Recover a long-running agent after interruption | Deliver safe resumption with observable partial progress. | A crash occurs between external action and durable recording. |

## Reference coverage: all 43 visible problems

The source identifier in each link is the reference problem slug. Titles in the catalog above are original Academy titles. Full protected solutions and hidden tests were not recovered.

| Academy ID | Reference problem |
|---|---|
| A001 | [react-loop-basic](https://www.agenticprep.io/problems/react-loop-basic) |
| A002 | [react-loop-tool-routing](https://www.agenticprep.io/problems/react-loop-tool-routing) |
| A003 | [react-loop-observation-recovery](https://www.agenticprep.io/problems/react-loop-observation-recovery) |
| A004 | [react-loop-budgeted-stop](https://www.agenticprep.io/problems/react-loop-budgeted-stop) |
| A005 | [react-loop-scratchpad-summary](https://www.agenticprep.io/problems/react-loop-scratchpad-summary) |
| A006 | [tool-schema-json](https://www.agenticprep.io/problems/tool-schema-json) |
| A007 | [tool-schema-typing](https://www.agenticprep.io/problems/tool-schema-typing) |
| A008 | [tool-schema-validation](https://www.agenticprep.io/problems/tool-schema-validation) |
| A009 | [tool-batch-runner](https://www.agenticprep.io/problems/tool-batch-runner) |
| A010 | [tool-result-normalizer](https://www.agenticprep.io/problems/tool-result-normalizer) |
| A011 | [sliding-window-memory](https://www.agenticprep.io/problems/sliding-window-memory) |
| A012 | [memory-summary-compression](https://www.agenticprep.io/problems/memory-summary-compression) |
| A013 | [memory-deduplicate-facts](https://www.agenticprep.io/problems/memory-deduplicate-facts) |
| A014 | [memory-pin-important](https://www.agenticprep.io/problems/memory-pin-important) |
| A015 | [rag-rerank](https://www.agenticprep.io/problems/rag-rerank) |
| A016 | [rag-chunk-splitter](https://www.agenticprep.io/problems/rag-chunk-splitter) |
| A017 | [rag-context-citations](https://www.agenticprep.io/problems/rag-context-citations) |
| A018 | [rag-relevance-filter](https://www.agenticprep.io/problems/rag-relevance-filter) |
| A019 | [eval-exact-match](https://www.agenticprep.io/problems/eval-exact-match) |
| A020 | [eval-score-rubric](https://www.agenticprep.io/problems/eval-score-rubric) |
| A021 | [react-loop-multi-tool-plan](https://www.agenticprep.io/problems/react-loop-multi-tool-plan) |
| A022 | [agent-human-approval-gate](https://www.agenticprep.io/problems/agent-human-approval-gate) |
| A023 | [agent-cost-latency-router](https://www.agenticprep.io/problems/agent-cost-latency-router) |
| A024 | [agent-supervisor-workflow](https://www.agenticprep.io/problems/agent-supervisor-workflow) |
| A025 | [agent-guarded-knowledge-workflow](https://www.agenticprep.io/problems/agent-guarded-knowledge-workflow) |
| A026 | [agent-capstone-runtime](https://www.agenticprep.io/problems/agent-capstone-runtime) |
| A027 | [guardrails-input-filter](https://www.agenticprep.io/problems/guardrails-input-filter) |
| A028 | [agent-observer-logger](https://www.agenticprep.io/problems/agent-observer-logger) |
| A029 | [agent-trace-diagnostics](https://www.agenticprep.io/problems/agent-trace-diagnostics) |
| A030 | [tool-retry-backoff](https://www.agenticprep.io/problems/tool-retry-backoff) |
| A031 | [tool-retry-fallback-policy](https://www.agenticprep.io/problems/tool-retry-fallback-policy) |
| A032 | [tool-research-assistant-pipeline](https://www.agenticprep.io/problems/tool-research-assistant-pipeline) |
| A033 | [memory-retrieve-query](https://www.agenticprep.io/problems/memory-retrieve-query) |
| A034 | [memory-ttl-eviction](https://www.agenticprep.io/problems/memory-ttl-eviction) |
| A035 | [rag-query-rewrite](https://www.agenticprep.io/problems/rag-query-rewrite) |
| A036 | [rag-support-agent-pipeline](https://www.agenticprep.io/problems/rag-support-agent-pipeline) |
| A037 | [rag-hybrid-merge](https://www.agenticprep.io/problems/rag-hybrid-merge) |
| A038 | [eval-prompt-injection](https://www.agenticprep.io/problems/eval-prompt-injection) |
| A039 | [eval-trajectory-trace](https://www.agenticprep.io/problems/eval-trajectory-trace) |
| A040 | [eval-seed-aggregation](https://www.agenticprep.io/problems/eval-seed-aggregation) |
| A041 | [eval-failure-summary](https://www.agenticprep.io/problems/eval-failure-summary) |
| A042 | [agent-system-design-review](https://www.agenticprep.io/problems/agent-system-design-review) |
| A043 | [agent-final-review-diagnostic](https://www.agenticprep.io/problems/agent-final-review-diagnostic) |
# Deployment and operation for a 150–200 person cohort

## Recommendation

Use **AWS Amplify Hosting + Cognito + API Gateway/Lambda + DynamoDB/S3 + SQS + AgentCore Code Interpreter + Bedrock**. This is the simplest operational fit for the stated AWS preference when the initial exercises use Python functions, prompt editing and a controlled step protocol. One cloud account and a versioned infrastructure definition reduce day-to-day administration. AgentCore Runtime, Memory, Gateway and Browser are optional later capabilities, not mandatory platform components.

Run a two-day engineering spike before committing the runner. Demonstrate an original Python exercise, a prompt evaluation through the trusted broker, a cancel/timeout, package availability, credential boundaries and 50 parallel sessions. If the interpreter cannot meet the required process, package or controlled-network contract, keep the portal architecture and replace only the runner adapter. This is a feasibility gate, not a claim that Code Interpreter already supplies a secure assessment harness.

“Internal” is assumed to mean internet-reachable with invitation-only authentication. If it means VPN/private-network-only access, the front-door architecture changes and must be priced separately. Proposed primary region is Mumbai (`ap-south-1`) for an India-based cohort, subject to Academy confirmation. AgentCore availability is documented there, but verify each required feature, model and quota in the actual account. Do not silently enable global inference routing if data must remain in India. [Supported regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html).

## Alternatives considered

| Option | Operational burden | Main trade-off | Recommendation |
|---|---|---|---|
| AWS serverless portal and AgentCore runner | One cloud, no cluster/VM patching; initial IAM and queue setup | More initial wiring than a frontend SaaS stack | Preferred under the stated AWS preference |
| Vercel + Supabase + isolated runner | Fast React/Postgres development and familiar admin UI | Several vendors and cross-cloud identity/network boundaries; still needs a real sandbox | Best fallback if fastest product iteration outweighs single-cloud operations |
| One EC2 machine with application and learner containers | Simple first demo | Server maintenance, shared-host isolation risk, capacity spikes and recovery burden | Avoid for the cohort's untrusted-code production service |
| Kubernetes / full remote IDE per learner | Flexible environments | Cluster, image, storage and session lifecycle complexity | Unnecessary for the initial cohort |

Vercel Pro advertises a $20/month base and Supabase Pro starts at $25/month; these are vendor plan charges, **not learner access tiers** and not the total platform bill. Include developer seats, sandbox consumption, model usage, storage, egress and observability before comparing. [Vercel pricing](https://vercel.com/pricing) · [Supabase pricing](https://supabase.com/pricing).

## Initial resource plan

| Resource | Proposed configuration | Why |
|---|---|---|
| Frontend | Static React SPA on Amplify; one production app, staging branch; custom domain/TLS | No application server needed just to deliver editors |
| Authentication | Cognito with one initial provider or invited email/password; explicit active membership | Avoid maintaining passwords ourselves; no open registration |
| API | HTTP API with JWT authorizer; small Lambda handlers | Separate fast CRUD from code execution |
| Job queue | SQS standard queue, dead-letter queue, durable outbox | Smooth synchronized class submissions and handle delivery retries |
| Worker | Lambda, 512 MB starting allocation, 240-second timeout for max-180-second jobs; benchmark memory | Trusted worker invokes isolated code remotely; no learner execution in its own process |
| Sandbox | One fresh Code Interpreter session per logical attempt; stop after completion | Prevent learner-to-learner persistence and control idle memory cost |
| Concurrency | Start at 40 active jobs, increase to 80 for scheduled cohort sessions after test | Account quotas are capacity ceilings; app limits protect cost and feedback latency |
| API rate limiter | Shared limiter below provider quotas, initially 20 invokes/sec across all workers | Per-worker limits do not protect a shared account quota |
| Metadata | DynamoDB on-demand with PITR enabled | Small operational dataset without database server management |
| Artifacts | Private S3, encryption, versioning and lifecycle policies | Draft snapshots, content packages and traces |
| Model service | Bedrock allowlisted model profiles, with explicit max-output tokens | No learner API keys and bounded spend |
| Operations | CloudWatch dashboards/alarms, budget ledger, audited admin controls | Cohort support can distinguish outages, learning failures and spending limits |

Do not assign one persistent sandbox per enrolled learner. Start a session on Run/Submit, then stop it. Keep drafts in platform storage. Code Interpreter is documented as supporting Python, JavaScript and TypeScript; its session state persists for the session lifetime, not as the learner's durable workspace. The documented default timeout is 15 minutes, configurable up to 8 hours. Use much shorter application limits. [Resource/session flow](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-resource-session-management.html) · [Session characteristics](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-session-characteristics.html).

AWS currently documents 1,000 concurrent Code Interpreter sessions, 2 vCPU/8 GB per session and 30 TPS for several session/invocation APIs. These are documented defaults, not verified account quotas. A single job may need multiple invocations, so request shaping must count API calls, not only submissions. [Quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html).

## Cohort capacity model

Planning assumptions: 200 enrolled; 200 simultaneously signed in during a workshop; 60–100 actively editing; a worst-case burst of 200 submissions. Separate editor concurrency from execution concurrency.

For short jobs averaging 20 seconds, 80 execution slots process approximately four jobs/second. A simultaneous 200-job burst needs three waves: up to approximately 40 seconds of queue wait and 60 seconds to complete the last wave, before startup, staging, grading and throttling overhead. With 60-second jobs, the same burst takes approximately three minutes. With only 40 slots it takes five waves. These are arithmetic estimates, not latency guarantees.

Proposed pilot targets: 200-client navigation and autosave without data loss; application API p95 below 1 second excluding execution; public short-run end-to-end p95 below 90 seconds in the 200-job burst; terminal state for all accepted jobs; no duplicate grades or leaked sessions; no cross-user access. Ordinary low-load runs should feel substantially faster, but measure cold starts before setting a UI promise.

Load test: ramp 20 → 50 → 100 → 200 clients; open library and problem; save changes; submit one 20-second synthetic job per client within a ten-second window; then test a 60-second workload. Observe queue age, starts/sec, invokes/sec, error rates, token throttling, worker memory and session cleanup. Repeat only after changing a failed bottleneck. Test a model-service outage and cancellation separately. Reserve account headroom for instructors and retries.

For live generation, model token quotas can bottleneck before sandbox capacity. At 60 calls/minute and 2,000 input tokens per call, plan for 120,000 input tokens/minute plus output/reservation behavior and judge traffic. Multiple trials multiply that demand. Actual quotas and inference routing are model/account/region-specific.

## Monthly planning estimate

All figures are USD, before tax and support. No promotional cloud credits or free-tier allowances are required for the model below. Prices were checked on 14 September 2026; regional quotes and selected model rates must be refreshed before deployment. The overall allowance is a planning estimate, not an AWS quotation.

**Base activity:** 200 learners × 20 active days × 6 code runs/day = 24,000 sandbox sessions/month. Count public runs and submissions in the same activity budget; do not count submissions twice. At 150 learners, usage components reduce to 75%, while fixed service overhead does not.

The displayed AgentCore Code Interpreter rates are $0.0895/vCPU-hour and $0.00945/GB-hour. CPU reflects active consumption; memory is billed using the service's peak-consumption rules through the session lifetime. “Waiting is free” is not a safe description of memory billing. [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/).

Illustrative light session: 8 active CPU seconds × 2 vCPU, plus 45 wall-clock seconds at an assumed 1 GB billed memory. Cost = `(16 × 0.0895 + 45 × 0.00945) / 3600` = approximately $0.000516/session, or **$12.38/month** for 24,000. This excludes system overhead not captured by the assumption.

Illustrative heavier session: 48 active seconds × 2 vCPU, plus 120 wall-clock seconds at 4 GB. Cost = `(96 × 0.0895 + 480 × 0.00945) / 3600` = approximately $0.003647/session, or **$87.52/month**. Measure initialization and actual billed memory to choose the realistic point in this range.

**Live-model assumption:** 200 learners × 20 days × 2 evaluated runs/day = 8,000 live runs. If each uses three candidate trials plus one judge call, that is 32,000 calls, not 8,000. At 2,000 input and 500 output tokens per call, that is 64 million input and 16 million output tokens.

| Illustrative token-rate scenario | Arithmetic | Monthly inference |
|---|---|---:|
| Economy planning rate: $0.30 input / $1.20 output per million | 64 × 0.30 + 16 × 1.20 | $38.40 |
| Premium planning rate: $3 input / $15 output per million | 64 × 3 + 16 × 15 | $432.00 |

These token rates are **scenario inputs**, not a quote for a named available model. The actual allowed model, regional rate and judge model must be selected and verified from [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/). Judges may consume more tokens than candidates, so the equal-size-call assumption must be replaced by pilot measurements. Agent loops can make more than one model call per trial; multiply accordingly.

| Cost component | Planning allowance / month | Basis |
|---|---:|---|
| Hosting, API, trusted workers, metadata, queue, S3, authentication, email and logs | $40–100 | Conservative aggregate allowance for this small cohort, not a priced bill of materials; excludes private networking and enterprise SSO add-ons |
| Candidate execution | $12–88 | Two consumption scenarios above |
| Model inference | $38–432 | Economy/premium scenarios above |
| Combined range | $90–620 | Sum of assumptions, before tax/support and contingency |

Start with a **$300/month operating target**, economy models for ordinary feedback, deterministic runs by default and limited live evaluations. An **up-to-$750/month planning envelope** adds room for premium-model experiments and workload uncertainty. These are recommendations to confirm, not authorized spend and not promises that an unlimited AI lab fits the amount. A cohort doing every test with a frontier model can exceed this materially. Multiply active months to plan programme spend; ongoing costs continue outside live class days if resources and learners remain active.

Base design avoids NAT gateways, a permanent vector database and long-lived agent memory. If private networking, SSO federation, WAF, managed relational storage, search or browser automation becomes required, price those additions explicitly. An Academy-wide “all problems open” policy can coexist with a fair per-user compute allowance and a cohort-wide spending limit.

## Spend controls

Implement an atomic budget ledger before enabling live calls. Reserve worst-case permitted model tokens and maximum run compute allowance per job, then reconcile measured usage. Initial policy proposal: one active job per learner, 30 public runs/day, 10 graded deterministic submissions/day and two live evaluated submissions/day, with instructor boosts for scheduled labs. Model retries consume the same allowance. These are adjustable resource policies, not paywalls or permanent content restrictions.

At 50%, 80% and 95% of cohort allowance, notify administrators. At the hard application threshold, pause new live inference while retaining deterministic practice and draft access. AWS billing alerts are delayed and are not an instantaneous hard cap. The application ledger is conservative and still cannot erase already-incurred cost. A kill switch disables new billable jobs and cancels eligible queued work without destroying learner drafts.

## Deployment sequence

1. Confirm region, identity provider, domain, data policy and budget. Choose separate development/staging and production accounts where possible; at minimum separate stacks and storage. Keep real learner data out of development.
2. Run the runner spike and record supported runtime/package versions, actual session permissions, timeout behavior, model access and quotas. Choose the adapter based on results.
3. Implement infrastructure in CDK TypeScript: authentication, private storage, tables, API, queues, IAM separation, workers, alarms and lifecycle policies. CI assumes a scoped role through federation; no static AWS keys in the repository.
4. Deploy the backend to staging, then build the frontend with the generated nonsecret API/auth configuration and connect the repository to Amplify Hosting. Configure SPA route rewrites, domain and HTTPS. Verify invitations and membership checks before publishing the URL to learners.
5. Seed only approved content versions. Import a small synthetic roster, then ten volunteer learners. Exercise all roles, draft recovery, public/hidden grading, outage handling, budget exhaustion and restore.
6. Run the 200-client load test and adversarial sandbox checks. Obtain any needed quota increase at least a week before the cohort. Record costs for representative exercises.
7. Release to production through CI. Pilot with 20–30 learners, review feedback and grade fairness, then invite the remaining cohort. Schedule no-change windows around assessments.
8. Keep the previous frontend build and backend artifact versions. Roll back code and prompt/evaluator configuration together; keep attempts pinned to their original versions. Use additive data migrations before deleting fields.

## Operating ownership

One named technical owner handles releases, alarms, restore and quotas. One content lead owns problem quality and rubric calibration. Instructors handle flagged learner evidence. Weekly: inspect job failures, costs, recurring misconception clusters and pending content reviews. Before each assessment: verify model access, queue capacity, live budgets and the recovery contact. Monthly: perform a sample restore and review access/retention.

Back up metadata with DynamoDB PITR and version artifacts in S3. A recovery drill restores to new resources, reconciles object references and switches configuration after validation. Proposed recovery objectives: restore service within four hours and lose no more than 24 hours of ungraded work; improve after measuring backup and restoration behavior. These are targets, not a managed-service guarantee.

## Engineering effort

Planning estimate for one experienced full-stack engineer working with a coding agent and a part-time content reviewer: 1–2 days runner spike; 3–5 days shell/auth/catalog/drafts; 5–8 days runner/evaluator/budgets; 3–5 days roadmaps/interview/cohort workflows; 3–5 days integration, load/security QA and pilot fixes. Roughly 3–5 working weeks depending on integrations and review availability. Authoring and calibrating 120 good challenges is a separate content programme, not a by-product of generating 120 titles. Start content review during the first week.

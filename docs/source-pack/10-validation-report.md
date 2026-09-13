# Handoff validation

Date: 14 September 2026.

## Completed checks

| Area | Result |
|---|---|
| Source inspection | Inspected all five live catalog pages and sampled the supplied recording across its full 4:18 duration; enlarged coding and learning-path frames |
| Reference coverage | 43 unique reference URLs mapped to 43 original Academy briefs |
| Catalog integrity | 120 unique IDs: 63 Agentic AI, 32 Generative AI, 25 FDE Practice |
| Difficulty coverage | 23 Easy, 47 Medium, 38 Hard, 12 Extreme |
| Reference integrity | All explicit prerequisite IDs and all interview-to-practice links resolve |
| Interview bank | 36 original prompts across 12 topics, each with answer signals and a follow-up |
| Executable examples | Four trusted reference implementations pass 19 cases; every supplied starter fails the intended checks |
| Data validity | All JSON files parse; embedded wireframe catalog matches the standalone catalog |
| JavaScript | Wireframe script passes syntax validation |
| Desktop visual review | Roadmap and split editor inspected at the browser's default 1280-pixel width |
| Mobile visual review | Roadmap and library inspected at 390-pixel width; page width equals viewport, with table scrolling contained |
| Persona interaction | Builder, Navigator and Accelerator visibly change roadmap content |
| Library interaction | Search and difficulty filters compose; approval search plus Hard returns the two matching briefs; Extreme filter returns 12 briefs |
| Draft interaction | An edited prompt persisted across reload; Reset restored the starter and retained a local backup |
| Guidance interaction | Easy progressive hint reveal works; Extreme presents no Guidance button and starts with an empty candidate artifact |
| Interview interaction | Empty answers do not reveal the rubric; an entered answer enables rubric review |
| Simulated job flow | Run/Submit enter queued state and render illustrative results; no actual execution is claimed |
| Cost arithmetic | Recomputed sandbox scenarios: $12.38 and $87.52; model scenarios: $38.40 and $432.00 |
| Source privacy | No source recording or account/sign-in screenshots are included in the deliverable archive |

Two presentation issues found during review were fixed: a narrow-screen persona selector/header layout and a desktop grid gap that could exceed its container. A stale Guidance view is also normalized when navigating to Hard or Extreme.

## Scope of verification

This is a validated design and planning handoff, not a production readiness certificate. The browser checks cover representative flows and layout, not a complete accessibility audit or all device/browser combinations. The local example verifier executes only supplied trusted files. It is not safe for arbitrary learner submissions.

The 120 entries remain explicitly labeled authoring briefs. The eight detailed specifications are at different readiness levels: deterministic reference examples are locally checked; prompt behavior and open-ended project rubrics require live-model calibration and content review. Nineteen sample tests demonstrate the intended contracts but do not establish exhaustive coverage. The publication gate requires additional boundary/mutation checks and reviewer approval.

## Required before cohort launch

Verify actual AWS credentials, account quotas, region/model support, runtime/package versions, IAM isolation, metadata credentials, network restrictions, grader separation, job cancellation and session cleanup. Run the 200-client load test, failure/recovery exercises, budget-boundary tests and a restore drill. Pilot semantic grading with human labels. Confirm membership/SSO, official personas, retention, approved branding, content rights and monthly spend. These checks are specified in the engineering and deployment documents but were not performed against a cloud account in this handoff.

## Prototype limits

The HTML contains local UI state, optional online font loading and browser-local drafts. It does not authenticate, execute Python, call a model, enforce server-side permissions, grade a learner or manage actual cohort records. Result selection deliberately simulates both pass and fail outcomes independently of editor content. Browser refresh resets transient UI state; only local drafts persist. Production must implement server-backed versions and state as specified in the PRD.

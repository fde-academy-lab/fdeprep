# FDE Academy Practice Lab: build pack

Prepared 14 September 2026.

**Recommendation:** build an original FDE Academy practice environment with the visual character of the inspected site, equal problem access, persona-specific roadmaps and guidance that decreases from Easy to Extreme. Use an AWS serverless portal with AgentCore Code Interpreter for isolated execution, subject to a short feasibility/security spike. Keep grading and model permissions in trusted services outside learner code.

## Start here

1. Open **03-interactive-wireframe.html** in a browser. Explore the roadmap, complete library, four guidance examples, editors, results, interview studio, progress and instructor view. It is a locally interactive prototype; execution and learner statistics are explicitly simulated.
2. Read **02-product-requirements.md** for the product contract and acceptance criteria.
3. Read **07-deployment-and-cost.md** for the infrastructure recommendation, cost assumptions and operating plan.
4. Give your coding agent **08-build-instructions.md** and this whole folder.

## Files

| File | Purpose |
|---|---|
| 01-reference-audit.md | What was observed in the live site and recording; what remains unknown; preserve/change decisions |
| 02-product-requirements.md | Product behavior, persona roadmaps, guidance, assessment and publication requirements |
| 03-interactive-wireframe.html | Clickable original visual proposal using Geist and a dark developer-workspace style |
| 04-engineering-specification.md | Trust boundaries, APIs, data model, runner protocol, lifecycle and UI contracts |
| 05-problem-catalog.md / .json / .csv | 120 original authoring briefs, including a source mapping for all 43 visible reference problems |
| 06-example-challenge-specifications.md | Eight detailed examples across GenAI/Agentic AI and all four difficulty levels |
| exercises/ | Four runnable deterministic authoring examples with starters, reference solutions and 19 tests |
| 07-deployment-and-cost.md | AWS-first recommendation, alternatives, resource plan, capacity, cost and deployment sequence |
| 08-build-instructions.md | Copy-ready phased prompts for Claude Code or Codex |
| 09-interview-bank.md / .json | 36 original interview prompts with answer signals, follow-ups and linked practice |
| 10-validation-report.md | Checks performed on this handoff and remaining production validation |

## Important status distinctions

- The live reference lists 43 coding problems. All 43 have a unique topic-equivalent mapping here.
- The 120 Academy entries are **authoring briefs**, not 120 completed runnable problems.
- Eight exercises have detailed specifications; four deterministic examples have locally tested implementations, including a bonus exact-edit exercise.
- Live-model exercise scoring and open-ended project grading still need calibration and implementation.
- The wireframe is interactive but does not execute Python, call models, authenticate learners or grade real submissions.
- No infrastructure has been deployed and no AWS-account configuration has been verified.
- Exact third-party solutions and hidden tests are not included. An authorized export can be integrated later.

The cost model suggests a $300/month initial operating target and an up-to-$750 planning envelope, subject to model choice, actual usage and measured runtime behavior. These are planning figures, not a quotation or authorization to spend. Use deterministic practice by default and bound live evaluations.

## Open decisions

Confirm the current Academy persona definitions/curriculum, approved branding, exact-content reuse rights if needed, identity provider, region/data residency, monthly budget and technical-screen assistance policy. The proposed persona starts are recommendations. Prior Academy context distinguishes personas from dynamic project pods; that distinction is retained.

The HTML can be opened directly. Online font loading is optional; it falls back to system fonts. For a stable local preview origin and local-draft persistence, serve this folder with a local static server. The sample verifier is for trusted authoring files only, never for arbitrary learner uploads.

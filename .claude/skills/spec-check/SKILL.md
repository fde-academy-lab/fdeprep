---
name: spec-check
description: Check a diff against the standing rules in CLAUDE.md and .claude/rules. Use before every pull request on this repository, before any push straight to main under the configuration exception in CLAUDE.md, and whenever asked whether a change is safe to ship.
---

# Spec check

Run against the diff you are about to publish: since the branch point for a
pull request, or since `origin/main` for a push straight to `main`. Report
violations with file and line. Do not fix them silently; list them and let the
author decide.

## Checks, in order of how much damage they do

1. **Learner code reaching a model.** Any import, client, credential or network
   call in `runner/` that could reach Bedrock or any model endpoint.
2. **Expected outputs staged into the sandbox.** Any path where a hidden test's
   expected value is written into the runner working directory.
3. **A component reading `difficulty` directly.** Everything asks the policy
   module. Grep for the field outside `lib/policy/`.
4. **A cap consumed on an error verdict.** Any counter increment that is not
   guarded on a terminal non-error verdict.
5. **Transcript rendering during an answer.** Any component under the Voice
   Screen that renders transcript text while a session is active.
6. **Delivery metrics escaping the debrief.** Words per minute, filler count or
   pause length appearing in a score, the competency heatmap, or the CSV export.
7. **A judge prompt in the database.** Judge prompts live in `judge/prompts/`.
8. **A migration that breaks the previous release.** A column dropped or renamed
   in the same release it stopped being used.
9. **A new assertion type without a fixture, a unit test and a validator entry.**
10. **A secret, an AWS key, or a credentialed database URL in the diff.**

## On a push straight to `main`

The configuration exception in `CLAUDE.md` sends these commits to `main` with no
reviewer, so this skill is the only gate they pass. Check ten above with more
care than usual, then three more:

11. **A file outside the configuration paths.** `CLAUDE.md` lists them. One file
    from `web/`, `runner/`, `judge/`, `infra/`, `.github/workflows/` or `docs/`
    in the diff sends the whole change to a branch, including the configuration
    part of it.
12. **A new entry in a vendored-skill allowlist.** `MATTPOCOCK_KEEP` and
    `ANTHROPIC_KEEP` in `scripts/bootstrap.sh` decide which third-party agent
    instructions land in this repository. A line added there needs the commit
    message to say what the skill does and whether it runs shell commands or
    fetches from the network. Without that, an unreviewed instruction set just
    entered the repository.
13. **A commit message that would not serve as a pull request body.** It is the
    only record of what changed and why.

## Also report

- Any library, API version or model identifier asserted without a documentation
  check recorded in the pull request body, or in the commit message on a push to
  `main`.
- Any new dependency that duplicates one already present.
- Any writing in `.claude/rules/02-writing.md`'s banned register that appears in
  learner-facing copy.

## Output shape

One table: rule, file and line, one sentence on what is wrong. Then a single
verdict line: safe to ship, or not, and why. On a push to `main`, "not" means
the change goes to a branch and opens a pull request instead.

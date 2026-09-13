---
name: spec-check
description: Check a diff against the standing rules in CLAUDE.md and .claude/rules before opening a pull request. Use before every pull request on this repository, and whenever asked whether a change is safe to merge.
---

# Spec check

Run against the diff since the branch point. Report violations with file and
line. Do not fix them silently; list them and let the author decide.

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

## Also report

- Any library, API version or model identifier asserted without a documentation
  check recorded in the pull request body.
- Any new dependency that duplicates one already present.
- Any writing in `.claude/rules/02-writing.md`'s banned register that appears in
  learner-facing copy.

## Output shape

One table: rule, file and line, one sentence on what is wrong. Then a single
verdict line: safe to merge, or not, and why.

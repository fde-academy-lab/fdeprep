#!/bin/bash
# FDE Prep bootstrap.
#
# Creates the .claude/ agent configuration and .gitignore inside the repository.
# These cannot be added through GitHub's web uploader, which silently skips any
# folder whose name begins with a dot.
#
# Run this once, from a Claude Code session, then commit and push to main.
# Everything it writes is idempotent, so running it twice is harmless.
#
#   bash scripts/bootstrap.sh                 config only
#   bash scripts/bootstrap.sh --with-skills   also vendor third-party skills
#
# After it finishes, commit:
#   git add -A && git commit -m "chore: agent configuration" && git push

set -euo pipefail

WITH_SKILLS=0
[ "${1:-}" = "--with-skills" ] && WITH_SKILLS=1

# Allowlist entries that turned out not to exist at their pinned ref. Collected
# across every repo and reported together at the end, so one run tells you
# everything to fix rather than one thing at a time.
VENDOR_ERRORS=""

if [ ! -f CLAUDE.md ] || [ ! -d docs ]; then
  echo "Run this from the repository root. Expected CLAUDE.md and docs/ here."
  exit 1
fi

say() { echo "[bootstrap] $*"; }

mkdir -p .claude/rules .claude/skills

say "writing .claude/settings.json"
cat > ".claude/settings.json" <<'__FDEPREP_01__'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR\"/scripts/install_pkgs.sh"
          }
        ]
      }
    ]
  }
}
__FDEPREP_01__

say "writing .claude/rules/01-trust-boundaries.md"
cat > ".claude/rules/01-trust-boundaries.md" <<'__FDEPREP_02__'
# Trust boundaries

These hold in every phase. A change that weakens one of them is a change to the
security model and needs saying out loud in the pull request, not a silent edit.

## The two Lambdas never merge

The runner executes learner code. It has no Bedrock permission, no database
write permission, and sits in a VPC with no internet route. The judge calls
models and never executes learner code. Results return through a queue.

If a task seems to need learner code to call a model, use the step protocol in
`docs/03-RUNNER-AND-GRADING.md` section 9.4 instead.

## Hidden means unpublished, not unreadable

Learner code can read anything staged into its own process. Stage one case, or
a bounded batch, per invocation. Never stage an expected output next to an
input. Comparison happens in the trusted evaluator, outside the sandbox.

## Never trust learner-reported anything

Pass counts, timings and result summaries printed by learner code are strings,
not facts. Parse bounded schema-valid output, then judge correctness
independently against values generated in the trusted path.

## Client input is never authoritative

The browser may not supply a sandbox id, an execution role, a model
identifier, a storage path, a difficulty, or a cap allowance. Every one of
those is resolved server-side from the enrolment and the problem version.

## A read-only editor range is not a boundary

Allowed edit regions on prompt-surgery problems are enforced on the server.
The editor's read-only styling is an affordance.

## An error verdict never consumes an allowance

Infrastructure failures are the platform's problem, not the learner's. This is
tested, not assumed.

## Prompt injection reaches the judge as data

Learner text going to a judge is wrapped in delimiters and labelled as data.
Judge output is parsed as JSON against a schema and rejected when it does not
conform. A design answer asking for full marks scores on content.
__FDEPREP_02__

say "writing .claude/rules/02-writing.md"
cat > ".claude/rules/02-writing.md" <<'__FDEPREP_03__'
# Writing rules for anything a person reads

Applies to learner-facing copy, error messages, empty states, pull request
bodies and documentation. Not to code comments.

## Say the thing

No "not X, but Y" constructions. No three clipped sentences in a row for
emphasis. No hedge openers: "it is worth noting", "it is important to
understand", "when it comes to". Delete the opener and the sentence after it
is the sentence.

## Every sentence carries a fact or a decision

Sentences that only manage the reader's expectations get deleted.

## Error messages name the next action

"Submission failed" is not a message. "The runner timed out after 10 seconds.
Your attempt was not counted. Try again." is a message.

## Learner-facing vocabulary

Never use "beginner". Never call the baseline diagnostic a test. Difficulty
labels are Easy, Medium, Hard and Extreme, and nothing else.

## No AI register

Avoid: delve, leverage as a verb, robust, seamless, holistic, unlock, elevate,
crucial, pivotal, myriad, plethora, tapestry, landscape, realm. The plain word
is shorter and reads as written by a person.

## Pick one noun and repeat it

Do not rename the same concept three ways in one screen. Repetition reads as
rigour; variation reads as uncertainty.
__FDEPREP_03__

say "writing .claude/skills/problem-authoring/SKILL.md"
mkdir -p ".claude/skills/problem-authoring"
cat > ".claude/skills/problem-authoring/SKILL.md" <<'__FDEPREP_04__'
---
name: problem-authoring
description: Author a new FDE Prep practice problem as validated YAML with public, hidden and adversarial tests, a reference solution and a naive solution that provably fails. Use whenever a new code, prompt or design problem is being written, or an existing one is being revised, or a topic from the catalogue backlog is being turned into a real problem.
---

# Problem authoring

Read `docs/04-PROBLEM-AUTHORING.md` before writing anything. This skill is the
loop, that document is the schema.

## The loop, in order

1. **Pick the failure, not the topic.** A problem exists to make one specific
   mistake happen. Write that mistake down in one sentence before anything
   else. If you cannot, there is no problem here yet.
2. **Write the brief as a situation.** Somebody is asking for something. The
   learner should be able to picture who. A brief that opens "implement a
   function that" is a task, and tasks teach nothing.
3. **Write the naive solution first.** The one an unprepared learner writes in
   four minutes. Save it as `naive_solution.py`.
4. **Write the hidden tests that catch it.** At least one hidden test must fail
   against the naive solution. If none do, the problem is decorative.
5. **Write the reference solution.** Save as `reference_solution.py`. Solve it
   from the stub in the editor, under the time estimate, without looking at
   the tests you wrote.
6. **Pick adversarial fixtures.** Hard and Extreme need at least one. Each
   carries an `annotation_md` that explains the trap after the attempt closes.
7. **Set the call budget** one above a clean solution and at least two below
   the naive one.
8. **Write hints as a narrowing sequence.** Hint one narrows the search space.
   Hint two names the mechanism. Hint three describes the shape of the fix. No
   hint contains the answer.
9. **Run the validator.** `python -m scripts.validate_problem <path>`.
10. **Run it through the runner.** `python -m runner.local <problem.yaml>
    <reference_solution.py>` must pass every gate, and the naive solution must
    fail at least one hidden test. Commit both results in the pull request body.

## Refuse to proceed when

- The topic has no source material and you would be inventing what an
  interviewer asks. Say so and ask. A thin problem is worse than a missing one.
- The naive solution passes everything you can think of. Either the problem is
  too easy for its tier or the hidden tests are wrong.
- You are tempted to write a seventh test because six felt thin. Count the real
  distinct failures instead.

## Never

- Put an expected output anywhere the sandbox can read it.
- Copy a problem statement, test or solution from another practice product.
- Add a competency tag outside the fixed vocabulary in `docs/00-PRD.md`.
- Mark a problem published. Author it review-ready and let a human publish.
__FDEPREP_04__

say "writing .claude/skills/voice-question-authoring/SKILL.md"
mkdir -p ".claude/skills/voice-question-authoring"
cat > ".claude/skills/voice-question-authoring/SKILL.md" <<'__FDEPREP_05__'
---
name: voice-question-authoring
description: Author a Voice Screen interview question with beats, live cue anchors, a rubric and three exemplar transcripts. Use whenever a spoken interview question is being written or revised for FDE Prep, or an entry from the interview bank is being turned into a runnable voice question.
---

# Voice question authoring

Read `docs/07-VOICE-SCREEN.md` sections 2 and 6 first.

## The loop

1. **Write the question as something a person says.** A client, an
   interviewer, a colleague. Not a prompt.
2. **Speak the strong answer out loud and time it.** That duration, rounded up,
   is `total_seconds`. Do not guess it. A question budgeted from imagination is
   always too short.
3. **Break that answer into four to six beats.** Three is not a pathway, seven
   is a script. Each beat is one move in the argument, not one topic.
4. **Budget each beat** from your own timed reading, not evenly.
5. **Write anchors from your own transcript.** Anchors are words a real answer
   actually contains. They drive live cue lighting through plain substring
   matching, so they must be phrases someone would say out loud, not jargon
   they would write.
6. **Write three exemplars as transcripts.** Spoken English, with the
   hesitations left in. Strong, adequate, weak. A polished written paragraph
   anchors the judge wrongly and every learner scores low against it.
7. **Write the rubric last**, so it describes what separated your three
   exemplars rather than what you hoped it would measure.
8. **Write follow-ups for Pressure mode** that attack the weakest load-bearing
   claim in the strong answer.

## Anchors are landmarks, not answers

`degrade` tells a learner there is territory here. It does not tell them what
to say about it. If an anchor list reads as an answer key, cut it back.

## Never

- Score fluency, accent, pace against a native-speaker band, or filler rate.
  Delivery metrics are reported and never scored. This is not a preference.
- Write an exemplar in written register.
- Put probe or follow-up text anywhere the learner can read it before they pass.
__FDEPREP_05__

say "writing .claude/skills/spec-check/SKILL.md"
mkdir -p ".claude/skills/spec-check"
cat > ".claude/skills/spec-check/SKILL.md" <<'__FDEPREP_06__'
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
__FDEPREP_06__

say "writing .gitignore"
cat > ".gitignore" <<'__FDEPREP_07__'
# secrets
.env
.env.*
!.env.example
*.pem
*.key

# node
node_modules/
.next/
out/
.turbo/

# python
__pycache__/
*.pyc
.venv/
.pytest_cache/
.ruff_cache/

# infra
cdk.out/
.aws-sam/

# local
.DS_Store
coverage/
playwright-report/
test-results/

# learner audio must never land in git
# docs/07 section 7 "Capture": 16kHz mono PCM streamed to Transcribe, plus a
# MediaRecorder copy for playback. MediaRecorder emits webm on Chromium and
# mp4/m4a on Safari.
*.wav
*.webm
*.mp3
*.m4a
*.mp4
*.ogg
*.opus
*.flac
*.pcm
__FDEPREP_07__

# ---------------------------------------------------------------------------
# Optional: vendor third-party agent skills into the repository.
#
# Repo .claude/skills/ is the only skill route that works reliably in a cloud
# session. The /plugin command is terminal-only and does nothing here.
#
# Only the skills named in the allowlists below are copied in. A skill is
# instructions an agent follows, and some of them run shell commands or fetch
# from the network, so the default is to take nothing and add deliberately.
# ---------------------------------------------------------------------------
if [ "$WITH_SKILLS" = "1" ]; then
  DEST=".claude/skills/vendor"
  mkdir -p "$DEST"

  # Pinned to the commits actually reviewed and vendored on 2026-09-13.
  # Move a pin only after reading the diff. Find a newer SHA with:
  #   git ls-remote https://github.com/<owner>/<repo> main
  MATTPOCOCK_REF="3cca18b368ae95cdbdebbff572ccafa662551015"
  ANTHROPIC_REF="34040c9c568585f6929bedeaad110ad08f079624"

  # Allowlists. Paths are relative to each repo's skills/ directory, and nothing
  # outside these lists is copied, so a re-run cannot restore a skill that was
  # reviewed and rejected. Of the 56 skills these two repos ship, 17 are taken.
  #
  # The rule used to build these: keep a skill only if it changes how code gets
  # designed, written, tested, reviewed or shipped in a TypeScript/Next.js plus
  # Python plus AWS repository. That dropped the document-production skills
  # (docx, pptx, xlsx, pdf), the design-asset skills, the two that impose a
  # ready-made visual identity and so collide with docs/08 (brand-guidelines,
  # theme-factory), the conversation-management skills, the eight the upstream
  # author marks in-progress, and the mattpocock skills that need a configured
  # issue tracker this repo does not use.
  #
  # Adding a line here vendors an agent instruction set into the repo. Read the
  # SKILL.md first, check whether it runs shell commands or fetches from the
  # network, and say so in the pull request.
  MATTPOCOCK_KEEP="
engineering/code-review
engineering/codebase-design
engineering/diagnosing-bugs
engineering/domain-modeling
engineering/grill-with-docs
engineering/prototype
engineering/research
engineering/resolving-merge-conflicts
engineering/tdd
engineering/wizard
misc/setup-pre-commit
productivity/grill-me
productivity/grilling
productivity/writing-for-agents
"

  ANTHROPIC_KEEP="
claude-api
frontend-design
webapp-testing
"

  # A pinned SHA is not a branch, so the first clone form always fails on one
  # and the fallback is what actually does the work. Both are kept: the shallow
  # form is faster whenever a ref is a branch name again.
  fetch_skills() {
    repo="$1"; ref="$2"; name="$3"; subdir="$4"; keep="$5"
    tmp="$(mktemp -d)"
    say "fetching $repo @ $ref"

    if ! { git clone --quiet --depth 1 --branch "$ref" "https://github.com/$repo" "$tmp" 2>/dev/null \
           || { git clone --quiet --filter=blob:none --no-checkout "https://github.com/$repo" "$tmp" \
                && git -C "$tmp" checkout --quiet "$ref"; }; }; then
      say "  could not fetch $repo, continuing"
      rm -rf "$tmp"
      return 0
    fi

    if [ ! -d "$tmp/$subdir" ]; then
      say "  no $subdir/ in $repo, leaving $DEST/$name untouched"
      rm -rf "$tmp"
      return 0
    fi

    # Everything upstream ships, so the run can report what it declined to take.
    find "$tmp/$subdir" -name SKILL.md -exec dirname {} \; \
      | sed "s|^$tmp/$subdir/||" | sort > "$tmp/.upstream"
    printf '%s\n' "$keep" | sed '/^[[:space:]]*$/d' | sort > "$tmp/.keep"

    rm -rf "${DEST:?}/$name"
    mkdir -p "$DEST/$name"

    copied=0
    missing=""
    while IFS= read -r path; do
      [ -z "$path" ] && continue
      if [ -d "$tmp/$subdir/$path" ]; then
        mkdir -p "$DEST/$name/$(dirname "$path")"
        cp -R "$tmp/$subdir/$path" "$DEST/$name/$(dirname "$path")/"
        copied=$((copied + 1))
      else
        missing="$missing $path"
      fi
    done <<__KEEPLIST__
$keep
__KEEPLIST__

    sha="$(git -C "$tmp" rev-parse HEAD 2>/dev/null || echo "$ref")"
    upstream_total="$(wc -l < "$tmp/.upstream" | tr -d ' ')"
    declined="$(comm -13 "$tmp/.keep" "$tmp/.upstream" | wc -l | tr -d ' ')"

    {
      echo "$repo@$sha"
      echo "curated subset: $copied of $upstream_total skills upstream ships at this ref."
      echo "The allowlist is MATTPOCOCK_KEEP / ANTHROPIC_KEEP in scripts/bootstrap.sh."
      echo "This folder is not a mirror. Do not re-add a skill by hand; add it to the list."
    } > "$DEST/$name/.source"

    say "  vendored $copied of $upstream_total, declined $declined"

    # A path in the list that is not in the clone means the pin moved under the
    # allowlist or upstream renamed something. Silence here would lose a skill
    # nobody decided to drop, so record it and keep going: every other repo
    # still gets vendored, and the run reports the whole list at the end.
    if [ -n "$missing" ]; then
      listname="$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')_KEEP"
      for path in $missing; do
        say "  MISSING: $path"
        VENDOR_ERRORS="$VENDOR_ERRORS$path  (in $listname, from $repo @ $ref)
"
      done
    fi

    rm -rf "$tmp"
  }

  fetch_skills "mattpocock/skills" "$MATTPOCOCK_REF" "mattpocock" "skills" "$MATTPOCOCK_KEEP"
  fetch_skills "anthropics/skills" "$ANTHROPIC_REF"  "anthropic"  "skills" "$ANTHROPIC_KEEP"

  say "vendored skills written to $DEST"
  say "re-running is safe: only the allowlisted skills are copied"
fi

echo
say "done. files created:"
find .claude -type f | sort | sed 's/^/[bootstrap]   /'
[ -f .gitignore ] && say "  .gitignore"
echo

if [ -n "$VENDOR_ERRORS" ]; then
  say "FAILED: these allowlist entries do not exist at their pinned ref"
  printf '%s' "$VENDOR_ERRORS" | sed 's/^/[bootstrap]   /'
  echo
  say "Upstream renamed or removed them, or a pin moved under the allowlist."
  say "Everything else was vendored, so the tree is complete apart from these."
  say "Fix the named lists in this script, then re-run. Do not commit until the"
  say "run is clean: a skill is missing here because nobody chose to drop it."
  exit 1
fi

say "next: git add -A && git commit -m \"chore: agent configuration\" && git push"

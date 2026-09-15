# SETUP: from this zip to a running build

Every fact about Claude Code below was verified against the official documentation on 14 September 2026. Links are inline. Check them again if a screen does not match, because the web product is in research preview and moves.

Claude Code on the web is available on Pro, Max and Team plans, and on Enterprise with premium or Chat plus Claude Code seats. <https://code.claude.com/docs/en/claude-code-on-the-web>

---

## Step 1: put this pack in the repository

Upload through the GitHub web UI, or push from a clone. Either works.

```
fdeprep/
  CLAUDE.md                  loads automatically in every session
  SETUP.md                   this file
  PROMPTS.md                 one prompt per build session
  README.md                  the two-minute version of this file
  .gitignore                 created by bootstrap.sh
  .claude/                   created by bootstrap.sh
    settings.json            SessionStart hook
    rules/                   trust boundaries and writing rules
    skills/                  three skills this build needs
  scripts/
    bootstrap.sh             creates .claude/ and .gitignore inside a session
    cloud-setup.sh           paste into the cloud environment dialog
    install_pkgs.sh          the hook the settings file points at
    sync-skills.sh           optional local skill vendoring
  docs/
    00-PRD.md .. 09-SOURCE-PACK-RECONCILIATION.md
    source-pack/             the earlier pack, kept as reference material
```

**GitHub's web uploader silently skips any folder whose name starts with a
dot.** After a browser upload, `.claude/` and `.gitignore` will be missing.
That is expected and you do not need to create them by hand. `scripts/`
uploads fine, and `scripts/bootstrap.sh` writes the dot-folders from inside
your first Claude Code session. See Step 5.

Nothing needs `chmod`. The hook invokes `bash scripts/install_pkgs.sh`
explicitly, so the executable bit is irrelevant.

## Step 2: make the repository private

Settings, General, scroll to the bottom, **Change repository visibility**, Private.

Do this before Session 2. From then on the repository holds hidden test fixtures and reference solutions, and a public repository hands those to any learner who looks.

The Claude GitHub App needs access to the repository once it is private. If it is already installed on the organisation, confirm `fdeprep` is in its repository list at <https://github.com/apps/claude>.

---

## Step 3: create the cloud environment

Go to <https://claude.ai/code>. Above the message box there is a cloud icon showing the current environment name. Click it, then **Add cloud environment**. There is no settings page for this; the selector is the only way in.

Fill in four fields.

### Name

```
fdeprep
```

### Network access: Full

You asked for Full, and Full is the right call for this build, because the setup script reaches GitHub release assets for fonts and Playwright reaches its own CDN for Chromium, neither of which is on the Trusted allowlist. <https://code.claude.com/docs/en/cloud-environments>

The one consequence worth naming: Full means a setup script can fetch and execute anything, in the same VM as your source. The mitigation is in Step 6, and it is cheap: pin every third-party source to a reviewed commit SHA, and read a skill before it runs next to your code.

### Environment variables

`.env` format, one pair per line. Anyone who can use the environment can read these, so nothing secret goes here.

```
NODE_ENV=development
DATABASE_URL=postgres://postgres:postgres@localhost:5432/fdeprep
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/fdeprep_test
PGHOST=localhost
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=fdeprep
REDIS_URL=redis://localhost:6379
AWS_REGION=ap-south-1
FDEPREP_ENV=cloud-session
PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
```

Change `AWS_REGION` to the region you will actually deploy into, so the CDK code Claude writes carries the right default. Mumbai is the obvious choice for an India-based cohort, subject to confirming that every service and model you need is available there.

### Setup script

Paste the entire contents of `scripts/cloud-setup.sh`.

It runs as root on Ubuntu 24.04 before Claude Code launches, must exit zero or the session fails to start, and must finish inside roughly five minutes or the environment cache cannot build. The script is written around all three constraints: every command ends in `|| true`, and the five independent installs run in parallel with `wait`.

What it sets up beyond the defaults:

| Addition | Why |
|---|---|
| PostgreSQL started, `fdeprep` and `fdeprep_test` created, password set | Postgres 16 is pre-installed but not running |
| Redis started | Same |
| ffmpeg and sox | Generating and inspecting audio fixtures for the Voice Screen |
| AWS CLI v2, CDK, SAM CLI, boto3 | Writing and synthesising infrastructure. Never deploying. |
| `public.ecr.aws/lambda/python:3.12` pre-pulled | The first runner image build starts fast |
| Playwright with Chromium | Browser testing the workspace and the cockpit |
| Inter and JetBrains Mono into `/opt/fonts` | Self-hosted fonts, so the app never depends on a font CDN |
| A version dump at the end | A failed install shows up in the setup log instead of mid-session |

The script runs once. Anthropic then snapshots the filesystem and later sessions start from that snapshot with everything already on disk. It re-runs when you edit the script, when you change the allowed domains, or after roughly seven days.

The snapshot keeps files, not processes, which is why the SessionStart hook starts Postgres and Redis again on every session.

---

## Step 4: what you get for free

Each session is a fresh Ubuntu 24.04 x86_64 VM, roughly 4 vCPUs, 16 GB RAM and 30 GB disk, with the repository cloned. You do not get a shell; Claude runs every command.

Already installed, so the setup script does not touch them: Python 3.x with pip, uv, pytest, ruff, mypy and black; Node 20, 21 and 22 with npm, yarn and pnpm; Docker and docker compose; PostgreSQL 16 and Redis 7.0; git, gh, jq and ripgrep. <https://code.claude.com/docs/en/cloud-environments>

This is the fact that shapes the whole plan: Docker and Postgres being present means every phase except the AWS deploy is fully buildable and testable inside a session.

---

## Step 5: AWS credentials do not go in the environment

Two reasons, both hard. Environment variables are readable by anyone using the environment. Interactive authentication such as AWS SSO is not supported in cloud sessions.

| Task | Where it runs |
|---|---|
| Writing CDK, Lambda handlers, the runner image | Cloud session |
| `cdk synth`, unit tests, `docker build`, running the runner locally | Cloud session, no credentials needed |
| `cdk deploy`, pushing images to ECR, migrating a real database | GitHub Actions with an OIDC role, or your own machine |

Claude writes `.github/workflows/deploy.yml` in Phase 6 and prints the exact IAM trust policy you need. You create the role once in the console. No long-lived key ever exists.

On Pro and Max, if a session later needs to call a non-AWS API, the environment's **API credentials** feature attaches the key outside the sandbox so Claude never sees it. Not available on Team or Enterprise yet.

---

## Step 6: skills and plugins

Three routes exist. Two of them work in cloud sessions and one does not.

| Route | Works in a cloud session | Notes |
|---|---|---|
| `.claude/skills/` in the repository | Yes | Part of the clone. This is the reliable route. |
| Skills enabled on your claude.ai account | Yes | Loaded automatically into cloud sessions |
| Plugins declared in `.claude/settings.json` | Yes | Installed at session start from the marketplace you declared. Needs network access to reach the source. |
| The `/plugin` slash command | **No** | Terminal only. It is not available in cloud sessions. |

That last row is the thing most setups get wrong. Do not plan on typing `/plugin install` in a web session.

### What to actually install

**Anthropic's own skills.** The official repository is <https://github.com/anthropics/skills>, registerable as a Claude Code plugin marketplace. `frontend-design` is the one that matters here: it exists specifically to stop generated interfaces looking generic, and it pairs with `docs/08-DESIGN-SYSTEM.md`. There is also an Anthropic-managed plugin directory at <https://github.com/anthropics/claude-plugins-official>.

**Matt Pocock's skills.** <https://github.com/mattpocock/skills>, MIT licensed, 261k stars, and already in Claude Code's official marketplace, so there is no marketplace to add first.

```bash
# in your local terminal, not a web session
claude plugins install mattpocock-skills
```

Five of them are worth having on this build specifically:

| Skill | Where it earns its place |
|---|---|
| `grill-me` | Run it before each phase against that phase's prompt. It finds the ambiguity in a spec before Claude Code builds the wrong reading of it. |
| `tdd` | Phases 1 and 3 are acceptance-test-first by design. This enforces the loop. |
| `diagnosing-bugs` | The mock LLM determinism failure in Phase 1 is exactly the kind of bug this is for. |
| `code-review` | Pairs with the `spec-check` skill in this pack. |
| `handoff` | When a session runs long, compacts it into something the next session can pick up. |

Run `/setup-matt-pocock-skills` once per repository before using the others.

**Cross-agent installer.** `npx skills@latest add <owner>/<repo>` writes skills into your repo as ordinary files you own and can edit, and works across agents. Installing both the plugin and the file copy leaves you with everything twice, so pick one.

### The route this pack recommends

Vendor them. Run `scripts/sync-skills.sh` on your own machine, read what it fetched, delete what you will not use, and commit the rest to `.claude/skills/vendor/`.

Three reasons. Committed skills are present in every cloud session with no network dependency. They are pinned, so nothing changes under you mid-build. And you will have read them, which matters, because a skill is instructions an agent follows and some of them run shell commands.

Fill in the two SHAs in the script before running it:

```bash
git ls-remote https://github.com/mattpocock/skills main
git ls-remote https://github.com/anthropics/skills main
```

Do not do this from the setup script. The setup script runs before the repository is cloned, and its output is snapshotted rather than versioned, so skills installed there are invisible to code review.

### On design skills specifically

On the Apple request, the honest answer: there is no Apple-published or Anthropic-published Apple design skill, Apple's Human Interface Guidelines describe Apple platforms, and the SF typeface family is licensed for use on Apple platforms. Copying that design language into a web app is a licensing question and, more to the point, the wrong target. This product is a dense, dark, keyboard-driven workspace.

`docs/08-DESIGN-SYSTEM.md` is the replacement and it is more useful than a generic design skill, because it is specific to this product. Inter and JetBrains Mono under the Open Font Licence, Lucide icons under ISC, Radix primitives and shadcn/ui under MIT, Motion for animation, a fixed six-step type scale, four state colours that each mean exactly one thing, and an accessibility floor. All of it permissive, all of it self-hosted.

Pair that document with `frontend-design` and you have both halves: the skill supplies the instinct against generic output, the document supplies the constraints for this specific interface.

There are large community skill collections that turn up when you search, covering Tailwind, shadcn and motion. They are unvetted third-party instructions and, with Full network access, they run next to your source. If you want one, pin it to a SHA, read it, and commit it like everything else.

---

## Step 7: run the build

Session B first, then the numbered phases.

One phase, one session, one branch, one pull request, merged before the next starts. A session can only push to its own working branch, which is a property of the GitHub proxy and the reason this shape fits.

`PROMPTS.md` has the prompt for each. Paste it into a new session at <https://claude.ai/code> with the `fdeprep` environment selected and the repository attached.

```
Session B   bootstrap config           straight to main, no PR
Session 0   foundations                chore/phase-0-foundations
Session 1   runner and mock LLM        feat/phase-1-runner
Session 2   problems and workspace     feat/phase-2-workspace
Session 3   scaffold ladder and caps   feat/phase-3-ladder
Session 4   prompt surgery and judge   feat/phase-4-prompt-judge
Session 5   tracks, progress, trace    feat/phase-5-progress
Session 6   rehearsal, admin, infra    feat/phase-6-admin
Session 7a  voice capture              feat/phase-7a-voice-capture
Session 7b  cockpit                    feat/phase-7b-cockpit
Session 7c  voice scoring and debrief  feat/phase-7c-voice-scoring
Session 8   content                    content/launch-set
```

Do not run the whole build in one session. The context runs out and the review surface becomes unreadable.

---

## Step 8: before the cohort touches it

1. A second person with AWS console access, the runbook in `docs/05-DEPLOY-AND-OPS.md` section 7, and one practice drill.
2. The database restore procedure run once against a real backup.
3. An AWS Budgets alarm on the Bedrock line, alerting at 50 and 80 percent.
4. The 200-concurrent-submission burst test run against staging.
5. The degraded mode toggle confirmed working, because it turns an outage into an inconvenience.

---

## Things that will bite you

| Symptom | Cause |
|---|---|
| Session fails to start after you edit the setup script | It exited non-zero. Every line needs `\|\| true`. |
| Postgres not running at session start | The snapshot keeps files, not processes. The SessionStart hook handles it. |
| A package works in one session and not the next | You installed it mid-session. Mid-session installs do not carry over; put it in the setup script. |
| Setup script times out | Over five minutes. Move the slow install into the parallel block, or drop it. |
| `echo $GH_TOKEN` prints `proxy-injected` | Expected. The proxy substitutes real credentials on outbound requests. A script reading the variable directly gets the placeholder. |
| A GitHub Projects v2 call fails | The proxy serves a pinned set of GraphQL operations. Use the REST fallback. |
| A large build gets killed | 16 GB ceiling. Split it or move that piece local. |
| Every session fails to authenticate | If your organisation uses IP allowlisting, Anthropic-hosted sessions fail. Support can exempt them. |
| `/plugin` does nothing | Terminal only. Not available in cloud sessions. |
| `next build` fails on `/_global-error` with `Cannot read properties of null (reading 'useContext')` | `NODE_ENV` is set to `development` in the session. Run `NODE_ENV=production npx next build`. Next.js warns about the non-standard value in the same output. |

---

## Running the Voice Screen locally

The voice socket is API Gateway in the cloud and a plain `ws` server on a
developer machine. Both run the same session code, so the local one is worth
using.

```
# terminal 1
cd voice
VOICE_STT=scripted VOICE_TOKEN_SECRET=pick-anything npm run dev

# terminal 2
cd web
VOICE_TOKEN_SECRET=pick-anything VOICE_SOCKET_URL=ws://localhost:8787 npm run dev
```

Then `/voice/consent` to accept, and `/voice/lab` to check the microphone and
stream. Transcripts print to the browser console and appear nowhere on screen.

`VOICE_STT=scripted` produces placeholder words driven by how loud you are, so
the pipeline is visible without an AWS credential. `VOICE_STT=transcribe` uses
Amazon Transcribe and needs one. The two `VOICE_TOKEN_SECRET` values have to
match: one end signs the session token and the other verifies it. It is a
secret, so it belongs in the environment and never in the repository.

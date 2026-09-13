#!/bin/bash
# FDE Prep cloud environment setup script.
# Paste the contents of this file into the Setup script field of the
# fdeprep cloud environment at claude.ai/code.
#
# Constraints this script is written around:
#   - It runs as root on Ubuntu 24.04, before Claude Code launches.
#   - It must exit zero, or the session fails to start. Hence || true everywhere.
#   - It must finish inside roughly five minutes, or the environment cache
#     cannot build. Independent installs run in parallel.
#   - Its result is snapshotted as a filesystem image. Files survive to later
#     sessions. Running processes do not, which is why Postgres is also
#     started by the SessionStart hook.

set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { echo "[cloud-setup] $*"; }

# ---------------------------------------------------------------------------
# 1. Databases. Pre-installed, not running.
# ---------------------------------------------------------------------------
log "starting postgres"
service postgresql start || true
su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\"" >/dev/null 2>&1 || true
su - postgres -c "createdb fdeprep" >/dev/null 2>&1 || true
su - postgres -c "createdb fdeprep_test" >/dev/null 2>&1 || true
service redis-server start || true

# ---------------------------------------------------------------------------
# 2. System packages. ffmpeg and sox are for the Voice Screen audio fixtures.
# ---------------------------------------------------------------------------
log "apt packages"
apt-get update -qq || true
apt-get install -y -qq ffmpeg sox libsox-fmt-all unzip zip graphviz shellcheck >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 3. Parallel block. Each of these is independent, so run them together and
#    wait. Sequentially they blow the five minute budget.
# ---------------------------------------------------------------------------
log "parallel toolchain installs"

(
  # AWS CLI v2. Used for cdk synth and for reading account state. Never deploy.
  curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip \
    && unzip -q -o /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install --update >/dev/null 2>&1
) || true &

(
  npm install -g aws-cdk @biomejs/biome >/dev/null 2>&1
) || true &

(
  pip install --break-system-packages -q aws-sam-cli boto3 pytest-cov >/dev/null 2>&1
) || true &

(
  # Lambda base image, so the first runner build is fast.
  docker pull public.ecr.aws/lambda/python:3.12 >/dev/null 2>&1
) || true &

(
  # Playwright with Chromium, for testing the workspace and the cockpit.
  npx --yes playwright@latest install --with-deps chromium >/dev/null 2>&1
) || true &

wait
log "parallel block done"

# ---------------------------------------------------------------------------
# 4. Self-hosted fonts. All SIL Open Font Licence 1.1. Cached here so the app
#    never depends on a font CDN at runtime or at build time.
# ---------------------------------------------------------------------------
log "fonts"
mkdir -p /opt/fonts && cd /opt/fonts || true
(
  curl -sSL -o inter.zip "https://github.com/rsms/inter/releases/latest/download/Inter.zip" \
    && unzip -q -o inter.zip -d inter
) || true
(
  curl -sSL -o jetbrains-mono.zip "https://github.com/JetBrains/JetBrainsMono/releases/latest/download/JetBrainsMono-2.304.zip" \
    && unzip -q -o jetbrains-mono.zip -d jetbrains-mono
) || true
cd / || true

# ---------------------------------------------------------------------------
# 5. Report what actually landed, so a failed install is visible in the log
#    rather than discovered mid-session.
# ---------------------------------------------------------------------------
log "versions"
{
  node --version
  python3 --version
  docker --version
  psql --version
  aws --version
  cdk --version
  ffmpeg -version | head -1
} 2>&1 | sed 's/^/[cloud-setup]   /' || true

log "done"
exit 0

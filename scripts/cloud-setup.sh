#!/bin/bash
# =============================================================================
# FDE Prep: cloud environment setup script
#
# Paste the whole of this file into the "Setup script" field when creating the
# fdeprep cloud environment at https://claude.ai/code
#
# Three constraints this is written around:
#   1. It runs as root on Ubuntu 24.04, before Claude Code starts.
#   2. It must exit 0. A non-zero exit means the session refuses to start,
#      which is why every command ends in || true.
#   3. It must finish in about five minutes or the environment cache cannot
#      build, which is why the five independent installs run in parallel.
#
# It runs once. Anthropic then snapshots the filesystem and later sessions
# start from that snapshot. The snapshot keeps files, not running processes,
# which is why scripts/install_pkgs.sh starts Postgres and Redis again on
# every session. It re-runs when you edit this script, when you change the
# allowed domains, or after roughly seven days.
# =============================================================================

set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
log() { echo "[cloud-setup] $*"; }

# Skip the slow parts if a cache rebuild lands on an already-provisioned disk.
if [ -f /opt/.fdeprep-provisioned ]; then
  log "already provisioned, starting services only"
  service postgresql start || true
  service redis-server start || true
  exit 0
fi

# -----------------------------------------------------------------------------
# 1. Databases. Postgres 16 and Redis 7 are pre-installed but not running.
# -----------------------------------------------------------------------------
log "postgres and redis"
service postgresql start || true
service redis-server start || true
su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\"" >/dev/null 2>&1 || true
su - postgres -c "createdb fdeprep"      >/dev/null 2>&1 || true
su - postgres -c "createdb fdeprep_test" >/dev/null 2>&1 || true
for db in fdeprep fdeprep_test; do
  su - postgres -c "psql -d $db -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'"   >/dev/null 2>&1 || true
  su - postgres -c "psql -d $db -c 'CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";'" >/dev/null 2>&1 || true
done

# -----------------------------------------------------------------------------
# 2. System packages. ffmpeg and sox are for Voice Screen audio fixtures.
# -----------------------------------------------------------------------------
log "apt packages"
apt-get update -qq >/dev/null 2>&1 || true
apt-get install -y -qq ffmpeg sox libsox-fmt-all unzip zip graphviz shellcheck >/dev/null 2>&1 || true

# -----------------------------------------------------------------------------
# 3. Parallel block. Run together and wait. Sequentially these blow the budget.
# -----------------------------------------------------------------------------
log "parallel toolchain installs"

(  # AWS CLI v2. For cdk synth and reading account state. Never for deploying.
  curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip \
    && unzip -q -o /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install --update >/dev/null 2>&1
) || true &

(  # CDK for infrastructure, Biome for lint and format, tsx for one-off scripts.
  corepack enable >/dev/null 2>&1
  npm install -g aws-cdk @biomejs/biome tsx >/dev/null 2>&1
) || true &

(  # SAM for local Lambda invocation, boto3 for the runner and judge.
  pip install --break-system-packages -q aws-sam-cli boto3 pytest-cov >/dev/null 2>&1
) || true &

(  # Images pulled now so the first runner build and the first local AWS test
  # do not wait. LocalStack gives SQS and S3 in-session with no AWS account.
  docker pull public.ecr.aws/lambda/python:3.12 >/dev/null 2>&1
  docker pull localstack/localstack:latest      >/dev/null 2>&1
) || true &

(  # Chromium for browser-testing the workspace and the Voice Screen cockpit.
  npx --yes playwright@latest install --with-deps chromium >/dev/null 2>&1
) || true &

wait
log "parallel block complete"

# -----------------------------------------------------------------------------
# 4. Self-hosted fonts, both SIL Open Font Licence 1.1. Cached here so the
#    application never depends on a font CDN at build time or at run time.
# -----------------------------------------------------------------------------
log "fonts"
mkdir -p /opt/fonts && cd /opt/fonts || true
( curl -sSL -o inter.zip "https://github.com/rsms/inter/releases/latest/download/Inter.zip" \
    && unzip -q -o inter.zip -d inter ) || true
( curl -sSL -o jbmono.zip "https://github.com/JetBrains/JetBrainsMono/releases/latest/download/JetBrainsMono-2.304.zip" \
    && unzip -q -o jbmono.zip -d jetbrains-mono ) || true
cd / || true

# -----------------------------------------------------------------------------
# 5. Report versions, so a failed install shows in the setup log rather than
#    being discovered halfway through a session.
# -----------------------------------------------------------------------------
touch /opt/.fdeprep-provisioned || true
log "versions"
{
  echo "node      $(node --version 2>&1)"
  echo "python    $(python3 --version 2>&1)"
  echo "docker    $(docker --version 2>&1)"
  echo "postgres  $(psql --version 2>&1)"
  echo "aws       $(aws --version 2>&1)"
  echo "cdk       $(cdk --version 2>&1)"
  echo "sam       $(sam --version 2>&1)"
  echo "ffmpeg    $(ffmpeg -version 2>&1 | head -1)"
  echo "fonts     $(find /opt/fonts -name '*.ttf' -o -name '*.woff2' 2>/dev/null | wc -l) files"
} 2>&1 | sed 's/^/[cloud-setup]   /' || true

log "done"
exit 0

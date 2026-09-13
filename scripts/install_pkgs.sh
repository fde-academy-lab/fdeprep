#!/bin/bash
# SessionStart hook, wired up in .claude/settings.json.
# Runs on every cloud session start and resume, and exits immediately
# outside a cloud session so local Claude Code is untouched.

set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# The environment snapshot keeps files, not processes.
service postgresql start || true
service redis-server start || true

[ -f package.json ]            && npm install --no-audit --no-fund >/dev/null 2>&1
[ -f runner/requirements.txt ] && pip install --break-system-packages -q -r runner/requirements.txt >/dev/null 2>&1
[ -f judge/requirements.txt ]  && pip install --break-system-packages -q -r judge/requirements.txt >/dev/null 2>&1

exit 0

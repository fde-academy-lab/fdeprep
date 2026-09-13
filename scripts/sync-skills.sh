#!/bin/bash
# Vendor third-party agent skills into the repository.
#
# Run this on YOUR machine, not in a cloud session. Read what it fetched,
# then commit it. Vendored skills are then present in every cloud session
# with no network dependency and no surprise updates.
#
# Why not do this in the cloud setup script: the setup script runs before the
# repository is cloned, and its output is snapshotted rather than versioned.
# Skills you have not read should not be executing next to your source code.

set -euo pipefail

DEST=".claude/skills/vendor"
mkdir -p "$DEST"

# Pin every source to a commit SHA. Replace these with the SHA you reviewed.
# Find one with: git ls-remote https://github.com/<owner>/<repo> main
MATTPOCOCK_SHA="REPLACE_WITH_REVIEWED_SHA"
ANTHROPIC_SHA="REPLACE_WITH_REVIEWED_SHA"

fetch() {
  local repo="$1" sha="$2" name="$3"
  local tmp
  tmp="$(mktemp -d)"
  echo "fetching $repo @ $sha"
  git clone --quiet --filter=blob:none --no-checkout "https://github.com/$repo" "$tmp"
  git -C "$tmp" checkout --quiet "$sha"
  rm -rf "${DEST:?}/$name"
  mkdir -p "$DEST/$name"
  cp -r "$tmp"/skills/* "$DEST/$name"/ 2>/dev/null || cp -r "$tmp"/* "$DEST/$name"/
  rm -rf "$tmp/.git"
  echo "$repo@$sha" > "$DEST/$name/.source"
  rm -rf "$tmp"
}

fetch "mattpocock/skills" "$MATTPOCOCK_SHA" "mattpocock"
fetch "anthropics/skills" "$ANTHROPIC_SHA" "anthropic"

cat <<'MSG'

Fetched. Now do the part that matters:

  1. Read every SKILL.md you just pulled in. A skill is instructions an agent
     will follow, and some of them run shell commands.
  2. Delete the ones you will not use. Fewer skills means less context spent
     on metadata scanning every session.
  3. git add .claude/skills/vendor && git commit

To update later, change the SHA and run this again.
MSG

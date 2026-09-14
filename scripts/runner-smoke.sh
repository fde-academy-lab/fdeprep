#!/bin/bash
# Build the runner image and invoke it through the Lambda runtime interface
# emulator, which the AWS Python base image already ships.
#
# Contract verified against
# https://docs.aws.amazon.com/lambda/latest/dg/python-image.html on 2026-09-13.
#
#   bash scripts/runner-smoke.sh
#
# Pass a CA bundle as $CA_BUNDLE when building behind a TLS-terminating proxy.

set -euo pipefail

IMAGE="${IMAGE:-fdeprep-runner:dev}"
NAME="${NAME:-fdeprep-rie}"
PORT="${PORT:-9000}"
ENDPOINT="http://localhost:${PORT}/2015-03-31/functions/function/invocations"
PROBLEM="problems/agent-loop/recover-from-soft-tool-errors.yaml"

say() { echo "[smoke] $*"; }

build_args=(--platform linux/amd64 --provenance=false -t "$IMAGE" .)
if [ -n "${CA_BUNDLE:-}" ]; then
  build_args=(--secret "id=ca_bundle,src=${CA_BUNDLE}" "${build_args[@]}")
fi

say "building $IMAGE"
docker buildx build "${build_args[@]}"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

say "starting the emulator on port $PORT"
docker run -d --name "$NAME" --platform linux/amd64 -p "${PORT}:8080" "$IMAGE" >/dev/null
ready=0
for _ in $(seq 1 30); do
  if curl -sS --noproxy '*' -o /dev/null "$ENDPOINT" -d '{}'; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  say "the emulator never answered on $ENDPOINT"
  docker logs "$NAME" 2>&1 | tail -20
  exit 1
fi

event_for() {
  python3 - "$1" <<'PY'
import json, pathlib, sys, yaml
problem = yaml.safe_load(pathlib.Path(
    "problems/agent-loop/recover-from-soft-tool-errors.yaml").read_text())
print(json.dumps({"submission_id": 1, "problem": problem,
                  "solution": pathlib.Path(sys.argv[1]).read_text()}))
PY
}

verdict_of() {
  curl -sS --noproxy '*' "$ENDPOINT" -d @- \
    | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r["verdict"], r["score"])'
}

say "reference solution"
reference=$(event_for problems/agent-loop/solutions/reference_solution.py | verdict_of)
say "  -> $reference"
[ "${reference% *}" = "pass" ] || { say "FAILED: the reference solution did not pass"; exit 1; }

say "naive solution"
naive=$(event_for problems/agent-loop/solutions/naive_solution.py | verdict_of)
say "  -> $naive"
[ "${naive% *}" = "fail" ] || { say "FAILED: the naive solution did not fail"; exit 1; }

say "both verdicts are what Phase 1 requires"

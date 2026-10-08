"""Lambda entry point.

Phase 1 wires the battery to an event. The S3 bundle read, the Postgres write
and the lease compare-and-set from docs/03 section 9.3 belong to Phase 2 and
are deliberately absent rather than stubbed, so nothing here looks finished
when it is not.
"""

from __future__ import annotations

import json
import os
from typing import Any

from runner.battery import scratch
from runner.battery.execute import BATTERIES, run_battery
from runner.problem import ProblemError, from_dict

IMAGE_TAG = os.environ.get("RUNNER_IMAGE_TAG", "runner:dev")

# What an event with no kind gets. Until 8 October 2026 the event docs/03
# defines carried no kind and the handler graded every event with the full
# battery, so an older worker's event keeps that for one release. It is also
# what a Submit runs, so a Submit from an older worker is graded as before.
WITHOUT_A_KIND = "submit"


def lambda_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Grade one submission.

    The event carries the problem, the solution and the submission's kind
    inline. The kind decides the batteries: a Run executes the public cases
    and the step checks, and a Submit or a rehearsal submit the full battery.
    """
    # Whatever an earlier invocation on this instance left in /tmp goes before
    # any learner code runs, including what a case killed mid-run left behind.
    # An instance that cannot clear it runs nothing.
    area = scratch.configured()
    if area:
        try:
            scratch.clear(area)
        except OSError as exc:
            return _error(
                "The runner could not clear the space it runs code in, so your code did "
                "not run. Your attempt was not counted. Try again.",
                detail=str(exc),
            )

    try:
        problem = from_dict(event["problem"], source="event.problem")
    except (KeyError, ProblemError) as exc:
        return _error(f"the event does not carry a runnable problem: {exc}")

    source = event.get("solution")
    if not isinstance(source, str) or not source.strip():
        return _error("the event does not carry a solution string")

    # A kind this runner does not grade is refused rather than guessed at:
    # guessing Submit would hand a Run the hidden battery, and guessing Run
    # would pass a Submit on its public cases alone.
    kind = event.get("kind", WITHOUT_A_KIND)
    if not isinstance(kind, str) or kind not in BATTERIES:
        return _error(f"the event names the kind {kind!r}, and this runner grades only "
                      f"{', '.join(BATTERIES)}")

    result = run_battery(
        problem,
        source,
        kind=kind,
        image_tag=IMAGE_TAG,
        already_passed=bool(event.get("already_passed")),
        hints_revealed=int(event.get("hints_revealed", 0)),
    )
    result["submission_id"] = event.get("submission_id")
    return result


def _error(message: str, detail: str | None = None) -> dict[str, Any]:
    """An error verdict never consumes an allowance (docs/03 section 8)."""
    result: dict[str, Any] = {
        "verdict": "error",
        "score": None,
        "message": message,
        "consumes_allowance": False,
        "runner": {"image_tag": IMAGE_TAG, "duration_ms": 0},
    }
    if detail:
        result["detail"] = detail
    return result


if __name__ == "__main__":
    print(json.dumps(lambda_handler(json.loads(os.environ.get("EVENT", "{}"))), indent=2))

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
from runner.battery.execute import run_battery
from runner.problem import ProblemError, from_dict

IMAGE_TAG = os.environ.get("RUNNER_IMAGE_TAG", "runner:dev")


def lambda_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Grade one submission.

    The event carries the problem and the solution inline. A queue-driven
    invocation that reads the bundle from S3 is Phase 2 work.
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

    result = run_battery(
        problem,
        source,
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

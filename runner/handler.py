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

from runner.battery.execute import run_battery
from runner.problem import ProblemError, from_dict

IMAGE_TAG = os.environ.get("RUNNER_IMAGE_TAG", "runner:dev")


def lambda_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Grade one submission.

    The event carries the problem and the solution inline. A queue-driven
    invocation that reads the bundle from S3 is Phase 2 work.
    """
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


def _error(message: str) -> dict[str, Any]:
    """An error verdict never consumes an allowance (docs/03 section 8)."""
    return {
        "verdict": "error",
        "score": None,
        "message": message,
        "consumes_allowance": False,
        "runner": {"image_tag": IMAGE_TAG, "duration_ms": 0},
    }


if __name__ == "__main__":
    print(json.dumps(lambda_handler(json.loads(os.environ.get("EVENT", "{}"))), indent=2))

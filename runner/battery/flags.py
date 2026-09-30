"""Trace post-processing from docs/03 section 6.

These flags are what make a trace teach. A learner who sees
repeated_identical_tool_call diagnoses their own bug without spending a hint.
"""

from __future__ import annotations

import json
from typing import Any

ANNOTATIONS = {
    "soft_error": "This observation carried an error in a 200 body.",
    "budget_exceeded": "This call was past the case's budget, so the runner refused it and it "
                       "never ran. It still counts as a call asked for.",
}


def annotate(trace: dict[str, Any], *, had_tools: bool,
             canary: str | None = None) -> dict[str, Any]:
    steps = trace.get("steps", [])
    flags: list[str] = []

    for step in steps:
        if step.get("type") == "observation" and _soft_error(step.get("value")):
            step["flags"] = sorted(set(step.get("flags") or []) | {"soft_error"})
            step["annotation"] = ANNOTATIONS["soft_error"]
            if "soft_error" not in flags:
                flags.append("soft_error")

    if _repeats(steps):
        flags.append("repeated_identical_tool_call")

    # The ceiling refuses the call that would pass it, so a count of answered
    # calls never can. A refused step is what says the budget was passed.
    for step in steps:
        if step.get("type") == "refused":
            step["flags"] = sorted(set(step.get("flags") or []) | {"budget_exceeded"})
            step["annotation"] = ANNOTATIONS["budget_exceeded"]
            if "budget_exceeded" not in flags:
                flags.append("budget_exceeded")

    tool_calls = sum(1 for s in steps if s.get("type") == "tool_call")

    if had_tools and tool_calls == 0:
        flags.append("no_tool_used")

    if canary and _canary_in_final(steps, canary):
        flags.append("injection_followed")

    trace["flags"] = sorted(set(flags))
    return trace


def _soft_error(value: Any) -> bool:
    """An error key sitting next to a success status."""
    if not isinstance(value, dict):
        return False
    status = value.get("status")
    if isinstance(status, int) and 200 <= status < 300:
        if value.get("error"):
            return True
        body = value.get("body")
        if isinstance(body, dict) and body.get("error"):
            return True
    return False


def _repeats(steps) -> bool:
    previous = None
    for step in steps:
        if step.get("type") != "tool_call":
            continue
        key = (step.get("tool"), json.dumps(step.get("args", {}), sort_keys=True))
        if key == previous:
            return True
        previous = key
    return False


def _canary_in_final(steps, canary: str) -> bool:
    return any(canary in str(s.get("value", "")) for s in steps if s.get("type") == "final")

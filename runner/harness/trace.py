"""Trace capture and the 256KB cap from docs/03 section 6."""

from __future__ import annotations

import json
from typing import Any

TRACE_LIMIT_BYTES = 256 * 1024
KEEP_HEAD = 40
KEEP_TAIL = 40
MAX_FIELD_CHARS = 8000


def clip(value: str, limit: int = MAX_FIELD_CHARS) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + f"...[{len(value) - limit} more characters]"


class Trace:
    """Ordered steps. Timings are recorded but never feed a gate."""

    def __init__(self) -> None:
        self.steps: list[dict[str, Any]] = []
        # Every prompt in full. The steps clip a prompt at MAX_FIELD_CHARS so
        # the trace stays small; an assertion about what reached the model
        # reads these, and as_dict never serialises them.
        self.prompts: list[str] = []
        # Calls the budget refused, by kind. They count toward every budget
        # measure, and a refused prompt never joins the prompts above.
        self.refused: dict[str, int] = {"llm": 0, "tool": 0}
        self._refused_step: dict[str, dict[str, Any]] = {}

    def _next_seq(self) -> int:
        return len(self.steps) + 1

    def llm_call(self, prompt: str, response: str, ms: int) -> None:
        self.prompts.append(prompt)
        self.steps.append({
            "seq": self._next_seq(),
            "type": "llm_call",
            "prompt": clip(prompt),
            "prompt_chars": len(prompt),
            "response": clip(response),
            "ms": ms,
        })

    def tool_call(self, tool: str, args: dict[str, Any], ms: int) -> None:
        self.steps.append({
            "seq": self._next_seq(),
            "type": "tool_call",
            "tool": tool,
            "args": _plain(args),
            "ms": ms,
        })

    def observation(self, value: Any) -> None:
        self.steps.append({
            "seq": self._next_seq(),
            "type": "observation",
            "value": _plain(value),
            "flags": [],
            "annotation": None,
        })

    def refusal(self, op: str, message: str, *, prompt: str | None = None,
                tool: str | None = None, args: Any = None) -> None:
        """A call past the case's ceiling, which the runner refused.

        The first refusal of each kind gets a step. Every later call of that
        kind is refused too, so it raises the step's repeat count instead of
        adding a step: a loop that swallows the refusal cannot grow the trace,
        or the runner's memory, no matter how long it runs.
        """
        self.refused[op] += 1
        if op in self._refused_step:
            self._refused_step[op]["repeats"] = self.refused[op] - 1
            return
        step: dict[str, Any] = {
            "seq": self._next_seq(),
            "type": "refused",
            "op": op,
            "message": clip(message, 2000),
        }
        if prompt is not None:
            step["prompt"] = clip(prompt)
            step["prompt_chars"] = len(prompt)
        if tool is not None:
            step["tool"] = tool
            step["args"] = _plain(args if args is not None else {})
        self._refused_step[op] = step
        self.steps.append(step)

    def final(self, value: Any) -> None:
        self.steps.append({
            "seq": self._next_seq(),
            "type": "final",
            "value": _plain(value),
        })

    def error(self, kind: str, message: str) -> None:
        self.steps.append({
            "seq": self._next_seq(),
            "type": "error",
            "error_type": kind,
            "message": clip(message, 2000),
        })

    def as_dict(self) -> dict[str, Any]:
        return {"steps": list(self.steps), "flags": [], "truncated": False}


def _plain(value: Any) -> Any:
    """Keep the trace JSON-serialisable whatever learner code handed back."""
    try:
        json.dumps(value)
        return _clip_strings(value)
    except (TypeError, ValueError):
        return clip(repr(value), 2000)


def _clip_strings(value: Any) -> Any:
    if isinstance(value, str):
        return clip(value)
    if isinstance(value, list):
        return [_clip_strings(v) for v in value[:200]]
    if isinstance(value, dict):
        return {str(k): _clip_strings(v) for k, v in list(value.items())[:200]}
    return value


def truncate(trace: dict[str, Any]) -> dict[str, Any]:
    """Keep the first 40 and last 40 steps, replace the middle with a marker."""
    if len(json.dumps(trace).encode()) <= TRACE_LIMIT_BYTES:
        return trace

    steps = trace["steps"]
    if len(steps) > KEEP_HEAD + KEEP_TAIL:
        omitted = len(steps) - KEEP_HEAD - KEEP_TAIL
        marker = {
            "seq": None,
            "type": "truncation_marker",
            "omitted": omitted,
            "message": f"{omitted} steps omitted to keep the trace under 256KB.",
        }
        trace["steps"] = steps[:KEEP_HEAD] + [marker] + steps[-KEEP_TAIL:]
    trace["truncated"] = True

    # Head and tail steps can still carry large prompts, so shrink fields until
    # the whole trace fits rather than returning something over the cap.
    limit = MAX_FIELD_CHARS
    while len(json.dumps(trace).encode()) > TRACE_LIMIT_BYTES and limit > 64:
        limit //= 2
        for step in trace["steps"]:
            for key in ("prompt", "response", "message"):
                if isinstance(step.get(key), str):
                    step[key] = clip(step[key], limit)
    return trace

"""The assertion registry. This runs in the trusted parent, never in the sandbox.

Every function here reads an Observed built from bounded, schema-valid output
that the sandbox sent back. Counts are recomputed from the trace steps rather
than taken from the sandbox's own totals, because a summary produced inside the
learner's process is a string, not a fact (docs/03 section 9.1).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable

import jsonschema


@dataclass(frozen=True)
class Observed:
    outcome: str
    return_value: Any
    exception: dict | None
    steps: tuple[dict, ...]
    llm_calls: int
    tool_calls: int

    @property
    def returned_text(self) -> str | None:
        return self.return_value if isinstance(self.return_value, str) else None


Result = tuple[bool, str | None]
Registry = dict[str, Callable[[dict, Observed], Result]]
REGISTRY: Registry = {}


def assertion(name: str):
    def register(fn):
        REGISTRY[name] = fn
        return fn
    return register


@assertion("returns_nonempty")
def _returns_nonempty(spec, ob) -> Result:
    text = ob.returned_text
    if text is None:
        return False, f"returned {type(ob.return_value).__name__}, expected a string"
    if not text.strip():
        return False, "returned an empty string"
    return True, None


@assertion("returns_matches")
def _returns_matches(spec, ob) -> Result:
    text = ob.returned_text
    if text is None:
        return False, f"returned {type(ob.return_value).__name__}, expected a string"
    if re.search(str(spec["value"]), text) is None:
        return False, f"return value did not match {spec['value']!r}"
    return True, None


@assertion("returns_equals")
def _returns_equals(spec, ob) -> Result:
    text = ob.returned_text
    if text is None:
        return False, f"returned {type(ob.return_value).__name__}, expected a string"
    if text.strip() != str(spec["value"]).strip():
        return False, "return value did not equal the expected string"
    return True, None


@assertion("terminates")
def _terminates(spec, ob) -> Result:
    if ob.outcome == "returned":
        return True, None
    reasons = {
        "timeout": "ran past the wall clock and was stopped",
        "budget": "kept calling until the budget ran out instead of returning",
        "raised": "raised instead of returning",
    }
    return False, reasons.get(ob.outcome, f"did not return ({ob.outcome})")


@assertion("llm_calls_at_most")
def _llm_calls_at_most(spec, ob) -> Result:
    limit = int(spec["value"])
    if ob.llm_calls > limit:
        return False, f"used {ob.llm_calls} model calls, allowed {limit}"
    return True, None


@assertion("tool_calls_at_most")
def _tool_calls_at_most(spec, ob) -> Result:
    limit = int(spec["value"])
    if ob.tool_calls > limit:
        return False, f"used {ob.tool_calls} tool calls, allowed {limit}"
    return True, None


@assertion("calls_tool")
def _calls_tool(spec, ob) -> Result:
    name = spec["name"]
    if name in _tool_names(ob):
        return True, None
    return False, f"never called {name}"


@assertion("does_not_call_tool")
def _does_not_call_tool(spec, ob) -> Result:
    name = spec["name"]
    if name in _tool_names(ob):
        return False, f"called {name}, which this case forbids"
    return True, None


@assertion("no_repeated_identical_tool_call")
def _no_repeated(spec, ob) -> Result:
    limit = int(spec.get("max_repeats", 1))
    run, previous, worst = 0, None, 0
    for call in _tool_calls(ob):
        key = (call["tool"], json.dumps(call.get("args", {}), sort_keys=True))
        run = run + 1 if key == previous else 1
        previous = key
        worst = max(worst, run)
    if worst > limit:
        return False, (
            f"called the same tool with the same arguments {worst} times in a row, "
            f"allowed {limit}"
        )
    return True, None


@assertion("handles_error")
def _handles_error(spec, ob) -> Result:
    """After an error-returning tool call, the next model prompt must differ."""
    last_prompt = None
    pending = False
    for step in ob.steps:
        kind = step.get("type")
        if kind == "llm_call":
            if pending:
                if step.get("prompt") == last_prompt:
                    return False, (
                        "the prompt after the failed tool call was identical to the one "
                        "before it, so the model had nothing new to work with"
                    )
                pending = False
            last_prompt = step.get("prompt")
        elif kind == "observation" and _is_error(step.get("value")):
            pending = True
        elif kind == "error":
            pending = True
    if last_prompt is None:
        return False, "never called the model"
    return True, None


@assertion("ignores_injection")
def _ignores_injection(spec, ob) -> Result:
    canary = str(spec["canary"])
    if canary in str(ob.return_value):
        return False, f"the injected canary {canary} reached the final answer"
    return True, None


@assertion("valid_json_return")
def _valid_json_return(spec, ob) -> Result:
    text = ob.returned_text
    if text is None:
        return False, "return value was not a string, so it cannot be JSON"
    try:
        parsed = json.loads(text)
    except ValueError as exc:
        return False, f"return value is not valid JSON: {exc}"
    schema = spec.get("schema")
    if schema:
        try:
            jsonschema.validate(parsed, schema)
        except jsonschema.ValidationError as exc:
            return False, f"return value did not match the schema: {exc.message}"
    return True, None


@assertion("no_exception")
def _no_exception(spec, ob) -> Result:
    if ob.outcome == "raised":
        kind = (ob.exception or {}).get("type", "an exception")
        message = (ob.exception or {}).get("message", "")
        return False, f"{kind} escaped: {message}".strip()
    return True, None


def _tool_calls(ob: Observed):
    return [s for s in ob.steps if s.get("type") == "tool_call"]


def _tool_names(ob: Observed):
    return {s.get("tool") for s in _tool_calls(ob)}


def _is_error(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, dict):
        if value.get("error"):
            return True
        body = value.get("body")
        if isinstance(body, dict) and body.get("error"):
            return True
    return False


class UnknownAssertion(KeyError):
    """An author wrote an assertion type the registry does not have."""


def evaluate(spec: dict, observed: Observed) -> dict:
    kind = spec.get("type")
    if kind not in REGISTRY:
        raise UnknownAssertion(
            f"unknown assertion {kind!r}; known types are {sorted(REGISTRY)}"
        )
    passed, message = REGISTRY[kind](spec, observed)
    return {"type": kind, "status": "pass" if passed else "fail", "message": message}

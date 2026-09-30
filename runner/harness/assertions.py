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
    # Each prompt in full, in call order. The steps hold clipped copies.
    prompts: tuple[str, ...] = ()

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


@assertion("returns_lacks")
def _returns_lacks(spec, ob) -> Result:
    """The answer must not contain the pattern: a card number, a token, a figure
    the evidence does not support. The failure names what was found, because
    the learner can act on their own text and cannot act on a regex."""
    text = ob.returned_text
    if text is None:
        return False, f"returned {type(ob.return_value).__name__}, expected a string"
    found = re.search(str(spec["value"]), text)
    if found is not None:
        shown = found.group(0) if len(found.group(0)) <= 80 else found.group(0)[:80] + "..."
        return False, f"the answer contains {shown!r}, which this case says must not appear"
    return True, None


def _prompts(ob: Observed) -> tuple[str, ...]:
    if ob.prompts:
        return ob.prompts
    return tuple(str(s.get("prompt", "")) for s in ob.steps if s.get("type") == "llm_call")


def _quoted(text: str) -> str:
    return repr(text if len(text) <= 80 else text[:80] + "...")


PROMPT_SCOPES = ("any", "every", "first", "last")


@assertion("prompt_contains")
def _prompt_contains(spec, ob) -> Result:
    """What reached the model, read from the prompts the runner answered.

    `in` is any (the default), every, first or last prompt.
    """
    prompts = _prompts(ob)
    if not prompts:
        return False, "no model call was made, so no prompt carried what this case expects"
    pattern = str(spec["value"])
    scope = spec.get("in", "any")
    if scope == "any":
        if any(re.search(pattern, p) for p in prompts):
            return True, None
        return False, f"no prompt sent to the model matched {pattern!r}"
    if scope == "first":
        chosen = [(1, prompts[0])]
    elif scope == "last":
        chosen = [(len(prompts), prompts[-1])]
    elif scope == "every":
        chosen = list(enumerate(prompts, 1))
    else:
        raise ValueError(f"prompt_contains reads any, every, first or last prompt, not {scope!r}")
    for number, prompt in chosen:
        if not re.search(pattern, prompt):
            return False, f"the prompt for model call {number} does not match {pattern!r}"
    return True, None


@assertion("prompt_lacks")
def _prompt_lacks(spec, ob) -> Result:
    """Nothing matching the pattern reached the model in any prompt. The
    failure names the call and the text, as returns_lacks does."""
    for number, prompt in enumerate(_prompts(ob), 1):
        found = re.search(str(spec["value"]), prompt)
        if found is not None:
            return False, (f"the prompt for model call {number} contains {_quoted(found.group(0))}, "
                           "which this case says must not reach the model")
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


@assertion("calls_tool_with")
def _calls_tool_with(spec, ob) -> Result:
    """One call to the tool carried every argument the case names, with that value.

    Arguments the case does not name are ignored, and values compare as JSON
    does, so 40 and "40" differ.
    """
    name = spec["name"]
    wanted = dict(spec.get("args") or {})
    calls = [call.get("args") for call in _tool_calls(ob) if call["tool"] == name]
    if not calls:
        return False, f"never called {name}"
    for args in calls:
        if isinstance(args, dict) and all(k in args and args[k] == v for k, v in wanted.items()):
            return True, None
    expected = ", ".join(f"{k}={json.dumps(v)}" for k, v in wanted.items())
    last = json.dumps(calls[-1], sort_keys=True, default=str)[:200]
    return False, f"called {name}, and no call had {expected}; the last call carried {last}"


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

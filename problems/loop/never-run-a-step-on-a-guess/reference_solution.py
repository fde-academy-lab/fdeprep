"""Reference solution for never-run-a-step-on-a-guess.

A plan is a graph, and its arguments draw it: "$refund.refund_id" makes the
email depend on the refund. The executor decides any step whose inputs are
all decided, so the order the model listed the steps in stops mattering, and
only real inputs count: a step that completed, and a field with a value in it.

A step whose input is missing is blocked and its tool is never called. The
block spreads to everything downstream of it and nowhere else, so a failed
collection holds the email and leaves the refund alone.

Failure is read from what the tool did. An exception, a None, an error key
inside a 200 and a status outside 2xx are the same thing to the steps that
were waiting on it.
"""

import json
import re

_PLAN = re.compile(r"Plan:\s*(\{.*\})", re.DOTALL)
_REFERENCE = re.compile(r"^\$([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$")


def _parse_plan(reply: str) -> list:
    found = _PLAN.search(reply)
    if found is None:
        return []
    try:
        steps = json.loads(found.group(1)).get("steps")
    except (ValueError, AttributeError):
        return []
    return [step for step in steps or [] if isinstance(step, dict) and step.get("id")]


def _references(step: dict) -> list:
    """(step id, field) for every argument that refers to another step."""
    refs = []
    for value in (step.get("args") or {}).values():
        found = _REFERENCE.match(value) if isinstance(value, str) else None
        if found:
            refs.append(found.groups())
    return refs


def _completed(result) -> bool:
    if not isinstance(result, dict) or result.get("error"):
        return False
    status = result.get("status")
    return isinstance(status, int) and 200 <= status < 300


def _resolve(step: dict, state: dict, outputs: dict):
    """The step's arguments with every reference replaced by a real value, or
    None when any reference does not have one."""
    args = {}
    for key, value in (step.get("args") or {}).items():
        found = _REFERENCE.match(value) if isinstance(value, str) else None
        if found is None:
            args[key] = value
            continue
        source, field = found.groups()
        if state.get(source) != "completed":
            return None
        real = outputs[source].get(field)
        if real is None or real == "":
            return None
        args[key] = real
    return args


def _call(tools: dict, step: dict, args: dict):
    try:
        return tools[step["tool"]](**args)
    except Exception:  # a tool that raises has failed, like one that says so
        return None


def run_agent(question: str, llm, tools: dict) -> str:
    steps = _parse_plan(llm(f"Request: {question}\nReply with the plan.\n"))
    in_plan = {step["id"] for step in steps}
    state = {}    # step id -> "completed", "failed" or "blocked"
    outputs = {}  # step id -> what its tool returned, for completed steps

    progress = True
    while progress:
        progress = False
        for step in steps:
            name = step["id"]
            if name in state:
                continue
            if any(source in in_plan and source not in state
                   for source, _ in _references(step)):
                continue  # an input has not been decided yet

            args = _resolve(step, state, outputs)
            if args is None:
                state[name] = "blocked"
            elif step.get("tool") not in tools:
                state[name] = "failed"
            else:
                result = _call(tools, step, args)
                state[name] = "completed" if _completed(result) else "failed"
                if state[name] == "completed":
                    outputs[name] = result
            progress = True

    # Anything still undecided waits on a cycle, and nothing in a cycle ever
    # has a real input.
    for step in steps:
        state.setdefault(step["id"], "blocked")

    report = {fate: [step["id"] for step in steps if state[step["id"]] == fate]
              for fate in ("completed", "failed", "blocked")}
    return json.dumps(report)

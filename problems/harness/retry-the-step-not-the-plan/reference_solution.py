"""Reference solution for retry-the-step-not-the-plan.

A retry resumes from the record of the last attempt, and the record decides
each step before the plan runs again. A completed step is never called again
and its recorded output is its output. A failed step runs once more only when
the record says the failure is retryable. Everything else runs when its
references resolve, exactly as on a first attempt.

A completed step whose output the record lost stays completed and uncalled,
and whatever needed that output is blocked. Running a finished refund to get
its reference back is how a customer is refunded twice.

An unreadable record runs nothing. Reading it as empty would make every step
look unattempted and run the plan from the top, which is the incident.
"""

import json
import re

_PLAN = re.compile(r"Plan:\s*(\{.*\})", re.DOTALL)
_REFERENCE = re.compile(r"^\$([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$")

_FATES = ("reused", "completed", "failed", "blocked")


def _parse_plan(reply: str) -> list:
    found = _PLAN.search(reply)
    if found is None:
        return []
    try:
        steps = json.loads(found.group(1)).get("steps")
    except (ValueError, AttributeError):
        return []
    return [step for step in steps or [] if isinstance(step, dict) and step.get("id")]


def _read_record(tools: dict):
    """The record's steps mapping, or None when there is no record to trust."""
    try:
        record = tools["run_record"]()
    except Exception:
        return None
    if not isinstance(record, dict) or not isinstance(record.get("steps"), dict):
        return None
    return record["steps"]


def _references(step: dict) -> list:
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


def _resolve(step: dict, fates: dict, outputs: dict):
    """step's arguments with every reference replaced by a real value, or None."""
    args = {}
    for key, value in (step.get("args") or {}).items():
        found = _REFERENCE.match(value) if isinstance(value, str) else None
        if found is None:
            args[key] = value
            continue
        source, field = found.groups()
        if fates.get(source) not in ("reused", "completed") or source not in outputs:
            return None
        real = outputs[source].get(field)
        if real is None or real == "":
            return None
        args[key] = real
    return args


def _call(tools: dict, step: dict, args: dict):
    try:
        return tools[step["tool"]](**args)
    except Exception:
        return None


def _report(steps: list, fates: dict) -> str:
    return json.dumps({fate: [step["id"] for step in steps if fates.get(step["id"]) == fate]
                       for fate in _FATES})


def run_agent(question: str, llm, tools: dict) -> str:
    steps = _parse_plan(llm(f"Retry the return: {question}\nReply with the plan.\n"))
    record = _read_record(tools)
    if record is None:
        return _report(steps, {step["id"]: "blocked" for step in steps})

    fates, outputs = {}, {}
    for step in steps:
        entry = record.get(step["id"])
        if not isinstance(entry, dict):
            continue
        if entry.get("state") == "completed":
            fates[step["id"]] = "reused"
            if isinstance(entry.get("output"), dict):
                outputs[step["id"]] = entry["output"]
        elif entry.get("state") == "failed" and entry.get("retryable") is not True:
            fates[step["id"]] = "failed"

    # From here this is a first attempt over whatever the record left open.
    in_plan = {step["id"] for step in steps}
    progress = True
    while progress:
        progress = False
        for step in steps:
            name = step["id"]
            if name in fates:
                continue
            if any(source in in_plan and source not in fates
                   for source, _ in _references(step)):
                continue

            args = _resolve(step, fates, outputs)
            if args is None:
                fates[name] = "blocked"
            elif step.get("tool") not in tools:
                fates[name] = "failed"
            else:
                result = _call(tools, step, args)
                fates[name] = "completed" if _completed(result) else "failed"
                if fates[name] == "completed":
                    outputs[name] = result
            progress = True

    for step in steps:
        fates.setdefault(step["id"], "blocked")
    return _report(steps, fates)

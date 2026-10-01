"""Reference solution for hold-one-action-for-approval-and-keep-working.

An approval gate holds one step, never the run. A step whose tool cannot be
undone, or whose tool the catalogue has never classified, goes to the
approver with its exact tool and arguments and is set aside. The walk then
carries on with every step that does not depend on it.

What a step depends on is decided before anything else about it. A step
runs, or is sent for approval, only when every step in its after-list is
done. A step behind a held, failed or waiting step waits too, and nobody is
asked to approve a step that cannot run yet.

Nothing in this run waits for an answer. The approver decides in their own
time, and the report says exactly which steps the next run has to pick up.
"""

import json
import re


def read_plan(reply: str) -> list:
    """The steps in a "Plan: [...]" reply, or [] when the reply holds none."""
    match = re.search(r"Plan:\s*(\[.*\])", reply, re.DOTALL)
    if not match:
        return []
    try:
        steps = json.loads(match.group(1))
    except ValueError:
        return []
    if not isinstance(steps, list):
        return []
    return [step for step in steps if isinstance(step, dict)]


def reversible(catalogue: dict, tool) -> bool:
    entry = catalogue.get(tool) if isinstance(tool, str) else None
    return isinstance(entry, dict) and entry.get("reversible") is True


def run_agent(question: str, llm, tools: dict) -> str:
    plan = read_plan(llm(
        f"Request: {question}\n"
        "Reply with Plan: [steps], each step an object with id, tool, args and "
        "after, the ids of the steps it needs done first.\n"
    ))
    catalogue = (tools["catalogue"]() or {}).get("tools") or {}
    report = {"done": [], "held": [], "waiting": [], "failed": []}
    done = set()

    for step in plan:
        name = step.get("id")
        tool = step.get("tool")
        args = step.get("args") or {}
        after = step.get("after") or []

        if not all(prerequisite in done for prerequisite in after):
            report["waiting"].append(name)
            continue

        if not reversible(catalogue, tool):
            tools["request_approval"](step=name, tool=tool, args=args)
            report["held"].append(name)
            continue

        try:
            result = tools[tool](**args)
        except Exception:
            result = None
        if isinstance(result, dict) and result.get("ok") is True:
            report["done"].append(name)
            done.add(name)
        else:
            report["failed"].append(name)

    return json.dumps(report)

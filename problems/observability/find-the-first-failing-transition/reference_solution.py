"""Reference solution for find-the-first-failing-transition.

The walk goes forwards and stops at the first match. Everything after it is
listed as a symptom and not diagnosed, because an agent run propagates state
and a broken step produces well-formed requests about nothing until the budget
runs out. The last error is the first one loud enough to raise, which is why
reading backwards sends people to the wrong team.

The model writes the sentence and does not choose the step. It is given the
first broken step and nothing after it, so it cannot be drawn to whichever
message looked scariest.
"""

import json
import re

EMPTY = (None, {}, [], "")
_ACTION = re.compile(r"Action:\s*(\w+)\(", re.MULTILINE)


def _broken(steps: list) -> list:
    """(step number, kind) for every broken step, in order."""
    found = []
    recent = []
    for index, step in enumerate(steps):
        kind = step.get("type")
        number = step.get("n")

        if kind == "error":
            found.append((number, "error"))
        elif kind == "observation" and step.get("value") in EMPTY:
            found.append((number, "empty_observation"))
        elif kind == "tool_call":
            signature = (step.get("tool"), json.dumps(step.get("args") or {}, sort_keys=True))
            recent.append((number, signature))
            recent = recent[-3:]
            if len(recent) == 3 and len({s for _, s in recent}) == 1:
                found.append((recent[0][0], "repeated_call"))
            continue
        if kind != "tool_call":
            recent = []
    return found


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Run: {question}\n"
    report = {"first_failure": None, "kind": None, "later_symptoms": [], "note": ""}

    for _ in range(8):
        output = llm(scratchpad)

        if "Action:" not in output:
            report["note"] = output.strip()
            return json.dumps(report)

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        result = tools[action.group(1)]() or {}
        steps = result.get("steps")
        broken = _broken(steps) if isinstance(steps, list) else []

        if broken:
            report["first_failure"], report["kind"] = broken[0]
            report["later_symptoms"] = [n for n, _ in broken[1:]]

        scratchpad += (
            f"{output}\nFirst broken step: {report['first_failure']} "
            f"({report['kind']}). Write one line an on-call engineer can read.\n"
        )

    return json.dumps(report)

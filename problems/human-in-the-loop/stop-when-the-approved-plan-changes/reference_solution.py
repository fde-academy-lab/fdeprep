"""Reference solution for stop-when-the-approved-plan-changes.

The approval covers one version of the whole plan. The executor runs that
version's steps in order and asks the planner before each one. A Replan is a
new version, whatever it contains, so the run stops at that step boundary:
the new version goes to the board with the exact list of what already ran,
and nothing in it runs here.

The executor never judges whether a change matters. A step that looks the
same in version 4 is still a step of version 4, and deciding it is safe would
be the executor approving version 4 itself, one step at a time.

Both ends fail closed. An approval that is declined or does not arrive runs
nothing. A step that raises or does not report success ends the run, and its
name goes under unknown, because nobody can say whether it took effect.
"""

import json
import re


def _report(outcome, ran, unknown, approved_version, current_version) -> str:
    return json.dumps({
        "outcome": outcome,
        "ran": ran,
        "unknown": unknown,
        "approved_version": approved_version,
        "current_version": current_version,
    })


def parse_replan(reply: str):
    """The steps a Replan carries, or None when the reply is not a Replan."""
    if not reply.startswith("Replan:"):
        return None
    try:
        steps = json.loads(reply.split("Replan:", 1)[1])
    except ValueError:
        steps = []
    # A Replan we cannot read is still the planner changing the plan.
    return steps if isinstance(steps, list) else []


def run_step(step: dict, tools: dict) -> bool:
    """True when the step reports success. Raises when nobody knows what happened."""
    result = tools[step["tool"]](**(step.get("args") or {}))
    return isinstance(result, dict) and result.get("ok") is True


def run_agent(question: str, llm, tools: dict) -> str:
    record = tools["approval"]()
    if not isinstance(record, dict) or record.get("approved") is not True:
        return _report("not_approved", [], [], None, None)

    version = record.get("version")
    steps = record.get("steps")
    if not isinstance(version, int) or not isinstance(steps, list):
        return _report("not_approved", [], [], None, None)

    ran = []
    last = "nothing has run yet"
    for step in steps:
        reply = llm(
            f"Request: {question}\n"
            f"Approved plan, version {version}: {json.dumps(steps)}\n"
            f"Ran so far: {json.dumps(ran)}\n"
            f"<observation>{last}</observation>\n"
            "Reply Continue to run the next step, or Replan: [steps] to replace "
            "every step that has not run.\n"
        ).strip()

        new_steps = parse_replan(reply)
        if new_steps is not None:
            tools["request_approval"](version=version + 1, steps=new_steps, ran=list(ran))
            return _report("awaiting_approval", ran, [], version, version + 1)

        if reply != "Continue" or step.get("tool") not in tools:
            return _report("halted", ran, [], version, version)

        try:
            succeeded = run_step(step, tools)
        except Exception:
            succeeded = False
        if not succeeded:
            return _report("halted", ran, [step["tool"]], version, version)

        ran.append(step["tool"])
        last = f"{step['tool']} succeeded"

    return _report("completed", ran, [], version, version)

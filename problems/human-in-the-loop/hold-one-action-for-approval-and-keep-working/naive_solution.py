"""What an unprepared learner writes in four minutes.

It treats the approval gate as a wall across the whole plan. The first step
that needs approval is sent to the approver, and the run stops there to wait,
so every step after it waits too, including the ones that never needed the
approval. That is the incident: the login suspension sat behind a mailbox
deletion nobody could approve until Monday.
"""

import json
import re


def read_plan(reply: str) -> list:
    match = re.search(r"Plan:\s*(\[.*\])", reply, re.DOTALL)
    if not match:
        return []
    try:
        steps = json.loads(match.group(1))
    except ValueError:
        return []
    return [s for s in steps if isinstance(s, dict)] if isinstance(steps, list) else []


def run_agent(question: str, llm, tools: dict) -> str:
    plan = read_plan(llm(f"Request: {question}\nReply with Plan: [steps]"))
    catalogue = tools["catalogue"]()["tools"]
    report = {"done": [], "held": [], "waiting": [], "failed": []}

    for position, step in enumerate(plan):
        if not catalogue[step["tool"]]["reversible"]:
            tools["request_approval"](step=step["id"], tool=step["tool"], args=step["args"])
            report["held"].append(step["id"])
            # Wait for the approver before going any further.
            report["waiting"] += [later["id"] for later in plan[position + 1:]]
            break
        result = tools[step["tool"]](**step["args"])
        if isinstance(result, dict) and result.get("ok") is True:
            report["done"].append(step["id"])
        else:
            report["failed"].append(step["id"])

    return json.dumps(report)

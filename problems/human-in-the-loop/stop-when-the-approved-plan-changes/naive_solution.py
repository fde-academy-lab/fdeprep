"""What an unprepared learner writes in four minutes.

It checks the approval once, at the door, and then does what the planner says.
A Replan swaps the steps that have not run yet for the new ones and the loop
carries on, so version 4 runs under the approval the board gave version 3.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    record = tools["approval"]()
    if not record.get("approved"):
        return json.dumps({"outcome": "not_approved", "ran": [], "unknown": [],
                           "approved_version": None, "current_version": None})

    steps = list(record["steps"])
    ran = []
    i = 0
    while i < len(steps):
        reply = llm(f"Plan: {json.dumps(steps)}\nRan so far: {ran}\n").strip()
        if reply.startswith("Replan:"):
            steps = steps[:i] + json.loads(reply.split("Replan:", 1)[1])
            continue

        step = steps[i]
        tools[step["tool"]](**step["args"])
        ran.append(step["tool"])
        i += 1

    return json.dumps({"outcome": "completed", "ran": ran, "unknown": [],
                       "approved_version": record["version"],
                       "current_version": record["version"]})

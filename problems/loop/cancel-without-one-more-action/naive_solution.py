"""What an unprepared learner writes in four minutes.

It reads the Run line on each reply, because the public case where a reply
arrives already cancelled makes that obvious, and then dispatches every action
the reply planned. It never reads the run state on a tool response, so a
cancel that lands while the first action of a reply is in flight does not stop
the second one, and the model is asked for another turn after the run stopped.
"""

import json
import re

ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Task: {question}\n"
    dispatched = []

    for _ in range(4):
        reply = llm(scratchpad)
        planned = [f"{name}({raw})" for name, raw in ACTION.findall(reply)]

        if "Run: live" not in reply:
            return json.dumps({"outcome": "cancelled", "dispatched": dispatched,
                               "held": planned, "note": "The run was cancelled."})

        if "Final Answer:" in reply:
            return json.dumps({"outcome": "finished", "dispatched": dispatched, "held": [],
                               "note": reply.split("Final Answer:", 1)[1].strip()})

        for name, raw in ACTION.findall(reply):
            args = dict(pair.strip().split("=", 1) for pair in raw.split(",") if "=" in pair)
            result = tools[name](**args)
            dispatched.append(f"{name}({raw})")
            scratchpad += f"{reply}\nObservation: {json.dumps(result)}\n"

    return json.dumps({"outcome": "unfinished", "dispatched": dispatched, "held": [],
                       "note": "I ran out of model calls."})

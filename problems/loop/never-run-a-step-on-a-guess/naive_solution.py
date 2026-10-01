"""What an unprepared learner writes in four minutes.

It walks the plan in the order the model wrote it, swaps each reference for
whatever the named step returned, and calls every tool. A step whose input
never arrived still runs: the reference comes out as an empty string or as
None, and the tool is handed that in place of an order id. Success is read
from the status code, so an error inside a 200 counts as done.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(f"Request: {question}\n")
    plan = json.loads(reply.split("Plan:", 1)[1])
    outputs = {}
    report = {"completed": [], "failed": [], "blocked": []}

    for step in plan["steps"]:
        args = {}
        for key, value in step["args"].items():
            if isinstance(value, str) and value.startswith("$"):
                source, field = value[1:].split(".", 1)
                value = (outputs.get(source) or {}).get(field)
            args[key] = value

        result = tools[step["tool"]](**args)
        outputs[step["id"]] = result
        if isinstance(result, dict) and result.get("status") == 200:
            report["completed"].append(step["id"])
        else:
            report["failed"].append(step["id"])

    return json.dumps(report)

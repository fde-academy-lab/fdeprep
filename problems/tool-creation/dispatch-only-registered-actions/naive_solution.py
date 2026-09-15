"""What an unprepared learner writes in four minutes.

It parses the action and indexes the tools dict with whatever name the model
produced. When the model invents a tool the index raises and the run dies with
a stack trace nobody outside engineering can read.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\((.*?)\)\s*$", output, re.MULTILINE)
        if action is None:
            continue

        args = {}
        for pair in action.group(2).split(","):
            if "=" in pair:
                key, value = pair.split("=", 1)
                args[key.strip()] = value.strip()

        result = tools[action.group(1)](**args)
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return "I could not complete this request."

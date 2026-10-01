"""What an unprepared learner writes in four minutes.

It checks for a Final Answer first and returns on the first one it sees, so a
reply carrying an answer and an action is read as an answer and the action is
dropped. When a reply is neither, it appends nothing and asks the same
question again until the budget runs out.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.match(r"Action:\s*(\w+)\((.*)\)", output)
        if action is None:
            continue

        args = {}
        for pair in action.group(2).split(","):
            if "=" in pair:
                key, value = pair.split("=", 1)
                args[key.strip()] = value.strip()

        result = tools[action.group(1)](**args)
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return "I could not finish this booking."

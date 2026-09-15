"""What an unprepared learner writes in four minutes.

It calls search, drops every chunk into the scratchpad and lets the model
decide what is worth using. The score is right there on each chunk and is
never read, so a 0.21 match is presented to the model as evidence and comes
back as a confident policy statement.
"""

import json
import re

NOTHING_FOUND = "I could not find anything in the help centre that answers this."


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\((.*?)\)\s*$", output, re.MULTILINE)
        if action is None:
            continue

        result = tools[action.group(1)](query=action.group(2).split("=", 1)[-1].strip())
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return NOTHING_FOUND

"""What an unprepared learner writes in four minutes.

It pastes each tool's result into the prompt as it came. A dict and a string
read fine, which is why the public tests pass. None reads to the model as a
broken tool, a raise leaves the loop before the model hears anything, and an
error body arrives with every word of its detail.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(3):
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
        scratchpad += f"{output}\nObservation: {result}\n"

    return "I could not answer that."

"""What an unprepared learner writes in four minutes.

One exit, and the model owns it. The loop breaks on a Final Answer and has no
opinion about anything else, so a model that keeps asking for one more lookup
keeps getting one until something outside this function runs out of patience.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    while True:
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\((.*?)\)\s*$", output, re.MULTILINE)
        if action is None:
            continue

        topic = action.group(2).split("=", 1)[-1].strip()
        result = tools[action.group(1)](topic=topic)
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

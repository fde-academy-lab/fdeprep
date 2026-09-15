"""What an unprepared learner writes in four minutes.

It parses the action, calls the tool, pastes the raw observation back into the
scratchpad and loops. It never looks inside a successful body, so a 200 that
carries an `error` key reads as a success and the loop keeps going.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(6):
        output = llm(scratchpad)

        if output.startswith("Final Answer:"):
            return output.split("Final Answer:", 1)[1].strip()

        action = re.match(r"Action:\s*(\w+)\((.*)\)\s*$", output)
        if action is None:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        name = action.group(1)
        args = {}
        for pair in action.group(2).split(","):
            if "=" in pair:
                key, value = pair.split("=", 1)
                args[key.strip()] = value.strip()

        result = tools[name](**args)
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return "I could not complete this request."

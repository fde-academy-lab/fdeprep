"""What an unprepared learner writes in four minutes.

It runs whatever the model asks for and returns when the model gives a Final
Answer. Whether the rebooking went through is left to the model, so a model
that asks for one more rebook after the airline confirmed the ticket gets one,
and a rebooking the airline confirmed at once is polled anyway.
"""

import json
import re

ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Request: {question}\n"

    for _ in range(4):
        reply = llm(scratchpad)
        if "Final Answer:" in reply:
            return reply.split("Final Answer:", 1)[1].strip()

        action = ACTION.search(reply)
        if action is None:
            continue

        args = dict(pair.strip().split("=", 1) for pair in action.group(2).split(",") if "=" in pair)
        result = tools[action.group(1)](**args)
        scratchpad += f"{reply}\nObservation: {json.dumps(result)}\n"

    return "The rebooking has not completed yet."

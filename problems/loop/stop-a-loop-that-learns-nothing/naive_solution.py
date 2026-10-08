"""What an unprepared learner writes in four minutes.

It keeps the step limit the contract asks for and adds nothing to it. A chat
whose search comes back empty on every call goes round until the limit: six
model calls for a question two of them settled, and the merchant is told the
assistant ran out of steps instead of being told that nothing was found.
"""

import json
import re

ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Merchant: {question}\n"
    last = None

    for _ in range(6):
        reply = llm(scratchpad)
        if "Final Answer:" in reply:
            return reply.split("Final Answer:", 1)[1].strip()

        action = ACTION.search(reply)
        if action is None:
            continue

        args = dict(pair.strip().split("=", 1) for pair in action.group(2).split(",") if "=" in pair)
        last = tools[action.group(1)](**args)
        scratchpad += f"{reply}\nObservation: {json.dumps(last)}\n"

    return f"Step limit reached: 6 model calls without an answer. Last result: {json.dumps(last)}"

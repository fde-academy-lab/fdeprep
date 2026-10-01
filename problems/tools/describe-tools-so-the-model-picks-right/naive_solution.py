"""What an unprepared learner writes in four minutes.

It replaces the one-liners with a sentence each saying what the tool does, and
publishes them properly. Nothing says when a tool is the wrong one or points to
the right one, so a customer who still has the item and wants their money back
gets refund_item, a dispatched order still gets cancelled, and nothing tells
the model that a return pays only when the item reaches the warehouse.
"""

import json
import re

DESCRIPTIONS = {
    "cancel_order": "Cancels an order and refunds the full amount.",
    "start_return": "Books a courier to collect an item from a delivered order.",
    "refund_item": "Refunds an item that is missing from an order.",
}


def run_agent(question: str, llm, tools: dict) -> str:
    lines = "\n".join(f"{name}: {text}" for name, text in DESCRIPTIONS.items())
    scratchpad = f"Tools:\n{lines}\n\nRequest: {question}\n"

    for _ in range(3):
        reply = llm(scratchpad)
        if "Final Answer:" in reply:
            return reply.split("Final Answer:", 1)[1].strip()

        action = re.search(r"^Action:\s*(\w+)\((.*)\)\s*$", reply, re.MULTILINE)
        if action is None:
            continue

        args = dict(pair.strip().split("=", 1) for pair in action.group(2).split(",") if "=" in pair)
        result = tools[action.group(1)](**args)
        scratchpad += f"{reply}\nObservation: {json.dumps(result)}\n"

    return "I could not finish this request."

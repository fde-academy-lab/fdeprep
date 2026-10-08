"""What an unprepared learner writes in four minutes.

It asks the model for JSON and returns the reply. The happy path works, which
is the whole problem: the fence and the trailing comma only show up on about
one ticket in six and the string still looks right in a trace.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Ticket: {question}\n"

    for _ in range(8):
        reply = llm(scratchpad)
        parsed = json.loads(reply)
        return json.dumps(parsed)

    return json.dumps({"category": "unknown", "priority": "unknown", "order_id": None})

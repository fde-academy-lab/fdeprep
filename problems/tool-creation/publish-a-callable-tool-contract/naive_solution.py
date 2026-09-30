"""What an unprepared learner writes in four minutes.

It gives every parameter a JSON type and publishes the contract, which is
enough for the model to use the right names. It says nothing about which
values room can take or which parameters have no default, so the model books
a terrace and books a meeting with no length, and the booking API fills both
gaps with defaults of its own.
"""

import json
import re

BOOK_ROOM = {
    "name": "book_room",
    "description": "Books a meeting room.",
    "input_schema": {
        "type": "object",
        "properties": {
            "room": {"type": "string", "description": "the room to book"},
            "start": {"type": "string", "description": "when the meeting starts"},
            "minutes": {"type": "integer", "description": "how long it lasts"},
            "note": {"type": "string", "description": "shown on the door"},
        },
    },
}


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Tools: {json.dumps([BOOK_ROOM])}\nQuestion: {question}\n"

    for _ in range(3):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\((\{.*\})\)\s*$", output, re.MULTILINE | re.DOTALL)
        if action is None:
            continue

        result = tools[action.group(1)](**json.loads(action.group(2)))
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return "I could not book that room."

"""Reference solution for publish-a-callable-tool-contract.

Everything the model knows about book_room is the contract in its first
prompt, so the contract carries everything the API client's declaration says.
The Literal becomes an enum, which is how the model learns that a terrace is
not a room. The parameters with no default are required, which is how it
learns to ask the member for a length when none was given. Types and
descriptions carry the unit and the time format.

The contract is built once and published as JSON before the question, so the
model reads the same description of the tool on every call.
"""

import json
import re

BOOK_ROOM = {
    "name": "book_room",
    "description": (
        "Book a meeting room for a length of time. Only the rooms listed can be "
        "booked."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "room": {
                "type": "string",
                "enum": ["Cedar", "Birch", "Oak"],
                "description": "The room to book, by its exact name.",
            },
            "start": {
                "type": "string",
                "description": "Local start time as YYYY-MM-DDTHH:MM.",
            },
            "minutes": {
                "type": "integer",
                "description": "Length of the meeting in minutes.",
            },
            "note": {
                "type": "string",
                "description": "Optional text shown on the screen by the door.",
            },
        },
        "required": ["room", "start", "minutes"],
    },
}

_ACTION = re.compile(r"Action:\s*(\w+)\((\{.*\})\)\s*$", re.MULTILINE | re.DOTALL)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Tools:\n{json.dumps([BOOK_ROOM])}\nQuestion: {question}\n"

    for _ in range(3):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a tool you have.\n"
            continue

        try:
            arguments = json.loads(action.group(2))
        except ValueError:
            arguments = None
        if not isinstance(arguments, dict):
            scratchpad += f"{output}\nThe arguments were not a JSON object.\n"
            continue

        result = tools[action.group(1)](**arguments)
        scratchpad += f"{output}\n<observation>{json.dumps(result)}</observation>\n"

    return "I could not book that room."

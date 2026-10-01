"""Reference solution for stop-when-the-job-says-completed.

The model proposes the next action. Whether the rebooking happened is the
airline's to say, and it says so in the status of a tool result. So the loop
reads the status of every result, from either tool, straight after the call,
and stops the moment it is exactly "completed": no other tool call and no
other model call. The answer comes from that result as well, because it holds
the ticket the airline actually issued.

A note that mentions completed, a status that is any other string, and a
result that is not a dict at all mean the same thing: not done yet.
"""

import json
import re

MAX_CALLS = 4
ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)
FINAL = re.compile(r"^Final Answer:\s*(.*)$", re.MULTILINE | re.DOTALL)


def arguments(raw: str) -> dict:
    """Turn 'booking=BK-1, flight=6E-2' into {'booking': 'BK-1', 'flight': '6E-2'}."""
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def completed(result) -> bool:
    """Only the status field can say the rebooking is done, and only with one word."""
    return isinstance(result, dict) and result.get("status") == "completed"


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Request: {question}\n"

    for _ in range(MAX_CALLS):
        reply = llm(scratchpad)

        final = FINAL.search(reply)
        if final:
            return final.group(1).strip()

        action = ACTION.search(reply)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{reply}\nThat was not an action you can take.\n"
            continue

        result = tools[action.group(1)](**arguments(action.group(2)))

        # The airline has answered. Nothing the model asks for next can make
        # this rebooking more done, and a second rebook would buy a second
        # ticket.
        if completed(result):
            return f"Rebooked on {result.get('flight')}, ticket {result.get('ticket')}."

        scratchpad += f"{reply}\nObservation: {json.dumps(result)}\n"

    return "The rebooking has not completed yet."

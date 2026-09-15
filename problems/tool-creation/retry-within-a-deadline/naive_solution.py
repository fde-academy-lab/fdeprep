"""What an unprepared learner writes in four minutes.

Exponential backoff with a cap on attempts, which is the textbook shape. The
deadline is checked after the wait rather than before it, so the loop always
overruns by its largest delay, and every non-200 is treated as retryable, so a
401 is tried five times.
"""

import json
import re

DELAYS = (1000, 2000, 4000, 8000)
DEADLINE_MS = 8000
MAX_ATTEMPTS = 5


def run_agent(question: str, llm, tools: dict) -> str:
    output = llm(f"Request: {question}\n")

    action = re.search(r"Action:\s*(\w+)\((.*?)\)\s*$", output, re.MULTILINE)
    if action is None:
        return json.dumps({"outcome": "exhausted", "attempts": 0, "waited_ms": 0})

    ship = tools[action.group(1)]
    order = action.group(2).split("=", 1)[-1].strip()

    waited = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        reply = ship(order=order) or {}

        if reply.get("status") == 200:
            return json.dumps({"outcome": "booked", "attempts": attempt, "waited_ms": waited})

        if attempt < MAX_ATTEMPTS:
            waited += DELAYS[attempt - 1]
            if waited > DEADLINE_MS:
                break

    return json.dumps({"outcome": "exhausted", "attempts": attempt, "waited_ms": waited})

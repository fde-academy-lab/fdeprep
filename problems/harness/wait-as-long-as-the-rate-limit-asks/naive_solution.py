"""What an unprepared learner writes in four minutes.

Exponential backoff with a deadline, which is the textbook shape and the one
the incident ran on. It never reads retry_after, so after a 429 it retries on
its own one, two and four second schedule while the service is still refusing
calls, and it retries a request the service rejected outright, because every
status that is not a 200 looks the same to it.
"""

import json
import re

DEADLINE_MS = 20000


def run_agent(question: str, llm, tools: dict) -> str:
    output = llm(f"Passenger request: {question}\n")
    found = re.search(r"Action:\s*rebook\((.*?)\)", output)
    if found is None:
        return json.dumps({"outcome": "rejected", "attempts": 0, "waited_ms": 0,
                           "retry_after_ms": None})

    args = {}
    for pair in found.group(1).split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()

    waited = 0
    attempts = 0
    while True:
        attempts += 1
        reply = tools["rebook"](**args)
        if reply.get("status") == 200:
            return json.dumps({"outcome": "booked", "attempts": attempts,
                               "waited_ms": waited, "retry_after_ms": None})
        wait = 1000 * 2 ** (attempts - 1)
        if waited + wait > DEADLINE_MS:
            return json.dumps({"outcome": "deferred", "attempts": attempts,
                               "waited_ms": waited, "retry_after_ms": wait})
        tools["sleep"](ms=wait)
        waited += wait

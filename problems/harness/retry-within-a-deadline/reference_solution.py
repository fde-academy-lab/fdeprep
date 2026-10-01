"""Reference solution for retry-within-a-deadline.

The deadline is spent before the wait rather than checked after it. Asking
"does the next delay fit in what is left?" before committing is a loop that
never exceeds 8000 ms. The same question asked afterwards always exceeds it by
one delay, and the last delay is the biggest.

A 401 is not retried, because it is not a temporary condition. A carrier that
stops answering raises instead of returning a status, so that is caught and
counted as a failed attempt rather than allowed to travel up to the caller.
"""

import json
import re

DELAYS = (1000, 2000, 4000, 8000)
DEADLINE_MS = 8000
MAX_ATTEMPTS = 5
RETRYABLE = (429, 503)

_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)


def _result(outcome, attempts, waited):
    return json.dumps({"outcome": outcome, "attempts": attempts, "waited_ms": waited})


def run_agent(question: str, llm, tools: dict) -> str:
    output = llm(f"Request: {question}\n")

    action = _ACTION.search(output)
    if action is None or action.group(1) not in tools:
        return _result("exhausted", 0, 0)

    ship = tools[action.group(1)]
    order = action.group(2).split("=", 1)[-1].strip()

    waited = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            reply = ship(order=order) or {}
        except Exception:
            reply = {"status": 503}

        status = reply.get("status")
        if status == 200:
            return _result("booked", attempt, waited)
        if status not in RETRYABLE:
            return _result("not_retryable", attempt, waited)

        if attempt == MAX_ATTEMPTS:
            break
        delay = DELAYS[attempt - 1]
        if waited + delay > DEADLINE_MS:
            break
        waited += delay

    return _result("exhausted", attempt, waited)

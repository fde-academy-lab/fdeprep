"""Reference solution for wait-as-long-as-the-rate-limit-asks.

A 429 that carries retry_after is the service saying when it will take the
call again, so a retry before then is a request the agent already knows will
be refused. The service's wait is a floor under the agent's own backoff rather
than a replacement for it: a service that answers "0" every time would
otherwise be called in a tight loop.

The deadline is spent before each wait, against what is left of it, and a wait
that does not fit goes back to the caller as the time to try again. A status
outside 429 and 503 says the request itself is wrong, and sending it again
sends the same wrong request.
"""

import json
import re

RETRYABLE = {429, 503}
DEADLINE_MS = 20000

_ACTION = re.compile(r"Action:\s*rebook\((.*?)\)\s*$", re.MULTILINE)


def backoff_ms(attempt: int) -> int:
    """The agent's own wait after attempt n: 1000, 2000, 4000 ms and so on."""
    return 1000 * 2 ** (attempt - 1)


def _result(outcome: str, attempts: int, waited_ms: int, retry_after_ms=None) -> str:
    return json.dumps({"outcome": outcome, "attempts": attempts,
                       "waited_ms": waited_ms, "retry_after_ms": retry_after_ms})


def _arguments(raw: str) -> dict:
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def _named_wait_ms(reply: dict):
    """The service's retry_after in milliseconds, or None when it named none.

    The header carries whole seconds as text. A value that is not a whole
    number of seconds names no wait the agent can use.
    """
    value = reply.get("retry_after")
    if value is None:
        return None
    text = str(value).strip()
    if not text.isdigit():
        return None
    return int(text) * 1000


def run_agent(question: str, llm, tools: dict) -> str:
    found = _ACTION.search(llm(f"Passenger request: {question}\n"))
    if found is None:
        return _result("rejected", 0, 0)
    args = _arguments(found.group(1))

    attempts = 0
    waited = 0
    while True:
        attempts += 1
        reply = tools["rebook"](**args)
        status = reply.get("status") if isinstance(reply, dict) else None
        if status == 200:
            return _result("booked", attempts, waited)
        if status not in RETRYABLE:
            return _result("rejected", attempts, waited)

        named = _named_wait_ms(reply)
        wait = backoff_ms(attempts) if named is None else max(named, backoff_ms(attempts))
        if waited + wait > DEADLINE_MS:
            return _result("deferred", attempts, waited, wait)
        tools["sleep"](ms=wait)
        waited += wait

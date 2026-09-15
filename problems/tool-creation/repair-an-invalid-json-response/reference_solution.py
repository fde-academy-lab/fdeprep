"""Reference solution for repair-an-invalid-json-response.

This service owns the contract with the client's workflow engine, so it is
this code that turns a JSON-shaped reply into parsable JSON. The fence comes
off, the parse is attempted, and a failure is reported back to the model once
with the parser's own complaint, which makes the retry a different question
rather than the same one asked again.

Nothing fills in a missing field. An invented order id routes a real
complaint to a stranger's order and looks exactly as plausible as a correct
one.
"""

import json
import re

_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)
GAVE_UP = {"category": "unknown", "priority": "unknown", "order_id": None}


def _unfenced(reply: str) -> str:
    found = _FENCE.match(reply)
    return found.group(1) if found else reply.strip()


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Ticket: {question}\n"

    for _ in range(8):
        reply = llm(scratchpad)
        body = _unfenced(reply)

        try:
            parsed = json.loads(body)
        except ValueError as exc:
            scratchpad += (
                f"{reply}\nThat reply did not parse as JSON: {exc}. "
                "Return the object on its own, with no code fence and no trailing comma.\n"
            )
            continue

        if not isinstance(parsed, dict):
            scratchpad += f"{reply}\nThat reply did not parse as a JSON object.\n"
            continue

        return json.dumps({
            "category": parsed.get("category", "unknown"),
            "priority": parsed.get("priority", "unknown"),
            "order_id": parsed.get("order_id"),
        })

    return json.dumps(GAVE_UP)

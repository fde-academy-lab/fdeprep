import json
from typing import Literal

from langchain_core.tools import tool
from pydantic import ValidationError

MAX_CALLS = 3
FALLBACK = "I could not finish this refund. A person will pick up your ticket."


def build_tools(tools: dict) -> dict:
    """The tools the model may call, by name. refund's body calls tools["order"] and tools["refund"]."""
    sent = []  # the payments service's first answer, once it has been called

    @tool
    def refund(order_id: str, amount_paise: int,
               reason: Literal["damaged", "late", "missing"]) -> dict:
        """Refund part or all of a grocery order to the customer's original payment method."""
        if sent:
            return {"error": "refund_already_sent", "first_answer": sent[0]}
        limit = tools["order"](order_id=order_id)["max_refund_paise"]
        if not 1 <= amount_paise <= limit:
            return {"error": [entry("amount_paise", amount_paise, f"integer from 1 to {limit}")]}
        sent.append(tools["refund"](order_id=order_id, amount_paise=amount_paise, reason=reason))
        return sent[0]

    return {"refund": refund}


def entry(field: str, sent, accepted) -> dict:
    return {"field": field, "sent": sent, "accepted": accepted}


def problems(chosen, exc: ValidationError) -> list:
    """One {"field", "sent", "accepted"} entry per item of exc.errors()."""
    found = []
    for item in exc.errors():
        field = ".".join(str(part) for part in item["loc"])
        schema = chosen.args.get(field, {})
        sent = None if item["type"] == "missing" else item["input"]
        found.append(entry(field, sent, schema.get("enum", schema.get("type"))))
    return found


def run_agent(question: str, llm, tools: dict) -> str:
    registry = build_tools(tools)
    prompt = f"Customer: {question}\n"
    for _ in range(MAX_CALLS):
        reply = llm(prompt).strip()
        prompt += reply + "\n"
        if reply.startswith("Done:"):
            return reply[len("Done:"):].strip()
        call = json.loads(reply[len("Call:"):])
        name, args = call.get("tool"), call.get("args") or {}
        chosen = registry.get(name)
        if chosen is None:
            found = [entry("tool", name, list(registry))]
        else:
            # The schema turns true into 1, so a bool is refused before it gets there.
            found = [entry(field, value, "integer") for field, value in args.items()
                     if isinstance(value, bool) and chosen.args.get(field, {}).get("type") == "integer"]
        if not found:
            try:
                prompt += f"Result: {json.dumps(chosen.invoke(args))}\n"
                continue
            except ValidationError as exc:
                found = problems(chosen, exc)
        prompt += f"Error: {json.dumps(found)}\n"
    return FALLBACK

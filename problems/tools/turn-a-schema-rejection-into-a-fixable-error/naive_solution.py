"""What an unprepared learner writes in four minutes.

It trusts the framework. Every call goes through the tool's invoke, and
anything that raises becomes "invalid input", so a refused reason or an unknown
tool name gets the same two words and the model sends the same call again. It
also trusts the schema's conversions, so `true` reaches the payments service
as an amount of 1, and it sends every refund the model asks for, a second one
included.
"""

import json
from typing import Literal

from langchain_core.tools import tool

MAX_CALLS = 3
FALLBACK = "I could not finish this refund. A person will pick up your ticket."


def build_tools(tools: dict) -> dict:
    """The tools the model may call, by name. refund's body calls tools["order"] and tools["refund"]."""

    @tool
    def refund(order_id: str, amount_paise: int,
               reason: Literal["damaged", "late", "missing"]) -> dict:
        """Refund part or all of a grocery order to the customer's original payment method."""
        return tools["refund"](order_id=order_id, amount_paise=amount_paise, reason=reason)

    return {"refund": refund}


def run_agent(question: str, llm, tools: dict) -> str:
    registry = build_tools(tools)
    prompt = f"Customer: {question}\n"
    for _ in range(MAX_CALLS):
        reply = llm(prompt).strip()
        prompt += reply + "\n"
        if reply.startswith("Done:"):
            return reply[len("Done:"):].strip()
        try:
            call = json.loads(reply[len("Call:"):])
            answer = registry[call["tool"]].invoke(call["args"])
            prompt += f"Result: {json.dumps(answer)}\n"
        except Exception:
            prompt += "Error: invalid input\n"
    return FALLBACK

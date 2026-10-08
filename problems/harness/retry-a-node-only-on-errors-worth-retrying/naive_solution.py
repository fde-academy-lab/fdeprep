import json
import re
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy

LANE = re.compile(r"Lane:\s*([A-Z]{3}-[A-Z]{3})")


def parse_prompt(question: str) -> str:
    return (f"Shipper: {question}\n"
            "Reply with the lane as 'Lane: <FROM>-<TO>', using three-letter city codes.")


def answer_prompt(question: str, outcome: str, quote, reserved: bool) -> str:
    return "\n".join([
        f"Shipper: {question}",
        f"Outcome: {outcome}",
        f"Quote: {json.dumps(quote, sort_keys=True)}",
        f"Reserved: {'yes' if reserved else 'no'}",
        "Write one or two sentences for the shipper. Say plainly when the price "
        "is an estimate, and when there is no price.",
    ])


class State(TypedDict):
    quote: dict
    reserved: bool
    card: dict


def run_agent(question: str, llm, tools: dict) -> str:
    max_attempts = tools["limits"]()["max_attempts"]
    lane = LANE.search(llm(parse_prompt(question))).group(1)
    attempts = 0

    def lookup(state):
        nonlocal attempts
        attempts += 1
        body = tools["carrier_rates"](lane=lane)
        hold = tools["reserve"](quote_id=body["quote_id"], key=f"{question.split(':')[0]}/reserve")
        return {"quote": body, "reserved": bool(hold.get("reserved"))}

    def fallback(state):
        return {"card": tools["rate_card"](lane=lane)}

    graph = StateGraph(State)
    graph.add_node("lookup", lookup, retry_policy=RetryPolicy(
        max_attempts=max_attempts, initial_interval=0, jitter=False, retry_on=Exception))
    graph.add_node("fallback", fallback)
    graph.add_edge(START, "lookup")
    graph.add_edge("lookup", "fallback")
    graph.add_edge("fallback", END)

    try:
        state = graph.compile().invoke({"quote": {}, "reserved": False, "card": {}})
        outcome, quote = "quoted", state["quote"]
    except Exception:
        state = {"reserved": False}
        outcome, quote = "degraded", tools["rate_card"](lane=lane)

    message = llm(answer_prompt(question, outcome, quote, state["reserved"]))
    return json.dumps({"outcome": outcome, "quote": quote, "attempts": attempts,
                       "reserved": state["reserved"], "message": message})

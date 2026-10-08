import json
import re
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, RetryPolicy

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


class Retryable(Exception):
    """A 200 whose body says try again. RetryPolicy only sees exceptions."""


class State(TypedDict):
    lane: str
    quote: dict
    outcome: str
    reserved: bool
    message: str


def verdict(body) -> str:
    """ok, retry or refused, for a carrier, reservation or rate card reply."""
    if not isinstance(body, dict):
        return "refused"
    error = body.get("error")
    if 400 <= int(body.get("status", 200)) < 500:
        return "refused"
    if error:
        return "retry" if isinstance(error, dict) and error.get("retryable") else "refused"
    return "ok"


def run_agent(question: str, llm, tools: dict) -> str:
    policy = RetryPolicy(max_attempts=int(tools["limits"]()["max_attempts"]),
                         initial_interval=0, jitter=False, retry_on=(TimeoutError, Retryable))
    key = f"{question.split(':')[0].strip()}/reserve"
    attempts = 0  # a failed attempt writes nothing to state, so the count lives here

    def parse(state):
        found = LANE.search(llm(parse_prompt(question)))
        return {"lane": found.group(1) if found else ""}

    def lookup(state):
        nonlocal attempts
        attempts += 1
        body = tools["carrier_rates"](lane=state["lane"])
        seen = verdict(body)
        if seen == "retry":
            raise Retryable(str(body["error"].get("code")))
        if seen == "refused":
            return {"outcome": "failed"}
        return {"quote": body, "outcome": "quoted"}

    def reserve(state):
        # Its own node, so a retry here never runs the lookup again, and the
        # same key on every attempt lets the carrier keep one hold.
        hold = tools["reserve"](quote_id=state["quote"]["quote_id"], key=key)
        if verdict(hold) == "retry":
            raise Retryable(str(hold["error"].get("code")))
        return {"reserved": verdict(hold) == "ok"}

    def fallback(state):
        try:
            card = tools["rate_card"](lane=state["lane"])
        except Exception:
            return {"outcome": "failed"}
        if verdict(card) != "ok":
            return {"outcome": "failed"}
        return {"quote": card, "outcome": "degraded"}

    def answer(state):
        quote = state["quote"] or None
        return {"message": llm(answer_prompt(question, state["outcome"], quote, state["reserved"]))}

    graph = StateGraph(State)
    graph.add_node("parse", parse)
    # A handler that returns a plain update ends the run, so each one says where to go.
    graph.add_node("lookup", lookup, retry_policy=policy,
                   error_handler=lambda state: Command(goto="fallback"))
    graph.add_node("reserve", reserve, retry_policy=policy,
                   error_handler=lambda state: Command(goto="answer", update={"reserved": False}))
    graph.add_node("fallback", fallback)
    graph.add_node("answer", answer)
    graph.add_edge(START, "parse")
    graph.add_edge("parse", "lookup")
    graph.add_conditional_edges("lookup", lambda state: "reserve" if state["outcome"] == "quoted" else "answer",
                                {"reserve": "reserve", "answer": "answer"})
    graph.add_edge("reserve", "answer")
    graph.add_edge("fallback", "answer")
    graph.add_edge("answer", END)

    final = graph.compile().invoke({"lane": "", "quote": {}, "outcome": "", "reserved": False,
                                    "message": ""})
    return json.dumps({"outcome": final["outcome"], "quote": final["quote"] or None,
                       "attempts": attempts, "reserved": final["reserved"],
                       "message": final["message"]})

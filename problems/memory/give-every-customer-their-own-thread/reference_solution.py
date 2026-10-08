"""Reference solution for give-every-customer-their-own-thread.

A checkpointer keeps one state per thread id, so the thread id is the key that
keeps one customer's memory out of another's. Each message runs on its
customer's own thread, and each customer's facts carry from message to message
because that thread's checkpoint carries them.

A paused thread is resumed only by an answer to its question. Anything else
cancels the confirmation and runs as a new turn: in langgraph 1.2.12 a new
input on a paused thread drops the paused step and starts from START, and the
thread keeps its facts. A message with no customer runs nowhere.
"""

import json
import re
from typing import Annotated, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

FACT = re.compile(r"^Fact:\s*(\w+)\s*=\s*(.+?)\s*$", re.MULTILINE)
DISPUTE = re.compile(r"^Dispute:\s*(.+?)\s*$", re.MULTILINE)
ANSWER = re.compile(r"^\s*(yes|no)\s*[.!]?\s*$", re.IGNORECASE)


def merge(old: dict, new: dict) -> dict:
    return {**old, **new}


class State(TypedDict):
    customer: str
    text: str
    facts: Annotated[dict, merge]
    dispute: str
    answer: str
    filed: bool


def build_graph(llm, tools):
    def turn(state):
        reply = llm(f"Facts so far: {json.dumps(state['facts'], sort_keys=True)}\n"
                    f"Customer message: {state['text']}\n"
                    "Reply with a Fact: key=value line for each new fact, and a Dispute: line "
                    "when the customer wants a charge disputed.")
        found = DISPUTE.search(reply)
        return {"facts": dict(FACT.findall(reply)), "dispute": found.group(1) if found else "",
                "answer": ""}

    def confirm(state):
        said = ANSWER.match(str(interrupt({"confirm": state["dispute"]})))
        return {"answer": said.group(1).lower() if said else ""}

    def file(state):
        tools["file_dispute"](customer=state["customer"], dispute=state["dispute"])
        return {"filed": True}

    graph = StateGraph(State)
    graph.add_node("turn", turn)
    graph.add_node("confirm", confirm)
    graph.add_node("file", file)
    graph.add_edge(START, "turn")
    graph.add_conditional_edges("turn", lambda state: "confirm" if state["dispute"] else END)
    graph.add_conditional_edges("confirm", lambda state: "file" if state["answer"] == "yes" else END)
    graph.add_edge("file", END)
    return graph.compile(checkpointer=InMemorySaver())


def run_agent(question: str, llm, tools: dict) -> str:
    app = build_graph(llm, tools)
    cancelled, unrouted = {}, 0

    for message in tools["sessions"]():
        customer = message.get("customer")
        if not customer:
            unrouted += 1
            continue
        config = {"configurable": {"thread_id": customer}}
        cancelled.setdefault(customer, 0)
        if app.get_state(config).interrupts:
            if ANSWER.match(message["text"]):
                app.invoke(Command(resume=message["text"]), config)
                continue
            cancelled[customer] += 1  # the new input below drops the paused step
        app.invoke({"customer": customer, "text": message["text"]}, config)

    customers = {}
    for customer, count in cancelled.items():
        snapshot = app.get_state({"configurable": {"thread_id": customer}})
        customers[customer] = {"facts": snapshot.values.get("facts", {}),
                               "filed": bool(snapshot.values.get("filed")),
                               "pending": bool(snapshot.interrupts), "cancelled": count}
    return json.dumps({"customers": customers, "unrouted": unrouted})

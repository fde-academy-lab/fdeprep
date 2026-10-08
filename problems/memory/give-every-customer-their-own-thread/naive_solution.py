"""What an unprepared learner writes in four minutes.

It keeps the team's one thread and fixes the half of the brief it noticed: when
the graph is paused, the next message resumes it. On a batch from one customer
that works. With two customers, every message reads and writes the same
checkpoint, so each customer's entry reports everyone's facts, and whatever the
next person types goes in as the answer to someone else's confirmation. A
question sent to a paused thread is treated as the answer too, so it never
reaches the model.
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
    config = {"configurable": {"thread_id": "main"}}
    customers = {}

    for message in tools["sessions"]():
        customer = message["customer"]
        if app.get_state(config).interrupts:
            app.invoke(Command(resume=message["text"]), config)
        else:
            app.invoke({"customer": customer, "text": message["text"]}, config)
        snapshot = app.get_state(config)
        customers[customer] = {"facts": snapshot.values.get("facts", {}),
                               "filed": bool(snapshot.values.get("filed")),
                               "pending": bool(snapshot.interrupts), "cancelled": 0}

    return json.dumps({"customers": customers, "unrouted": 0})

import json
import operator
import re
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

SPECIALISTS = {"billing": "billing_lookup", "network": "network_status",
               "plan_change": "plan_options"}
ROUTE = re.compile(r"^Route:\s*(\S+)\s*$")


def supervisor_prompt(message: str, answered: dict, refused: list) -> str:
    lines = [f"Customer: {message}"]
    for name, answer in answered.items():
        lines.append(f"{name} answered: {answer}")
    for reason in refused:
        lines.append(f"Refused: {reason}")
    lines.append("Reply with one line: Route: billing, Route: network, "
                 "Route: plan_change or Route: done.")
    return "\n".join(lines)


class State(TypedDict):
    answered: Annotated[dict, operator.or_]  # each specialist adds only its own line
    route: list
    hops: int
    next: str
    asked_for: str
    outcome: str


def run_agent(question: str, llm, tools: dict) -> str:
    chat = json.loads(question)
    max_hops = int(tools["limits"]()["max_hops"])

    def supervisor(state):
        refused = []
        for _ in range(2):  # one ask, and one more after a refusal
            reply = llm(supervisor_prompt(chat["message"], state["answered"], refused)).strip()
            match = ROUTE.match(reply)
            name = match.group(1) if match else reply[:80]
            if name == "done":
                if state["answered"]:
                    return {"next": "end", "outcome": "completed"}
                refused = ["done, and no specialist has answered yet"]
            elif name in SPECIALISTS:
                if name in state["answered"]:
                    refused = [f"{name} has already answered"]
                elif state["hops"] >= max_hops:
                    return {"next": "end", "outcome": "partial"}
                else:
                    return {"next": name, "hops": state["hops"] + 1}
            else:  # a name the graph has no node for
                return {"next": "human", "asked_for": name}
        return {"next": "end", "outcome": "partial"}

    def specialist(name):
        def answer(state):
            result = tools[SPECIALISTS[name]](account=chat["account"])
            line = str(result.get("answer") or f"{name} could not answer")
            # Only the answer line goes on; the notes are for staff.
            return {"answered": {name: line.splitlines()[0]}, "route": state["route"] + [name]}
        return answer

    def human(state):
        tools["human"](chat=chat["chat"], asked_for=state["asked_for"],
                       answers=state["answered"])
        return {"route": state["route"] + ["human"], "outcome": "human"}

    graph = StateGraph(State)
    graph.add_node("supervisor", supervisor)
    for name in SPECIALISTS:
        graph.add_node(name, specialist(name))
        graph.add_edge(name, "supervisor")
    graph.add_node("human", human)
    graph.add_edge(START, "supervisor")
    graph.add_conditional_edges(
        "supervisor", lambda state: state["next"],
        {**{name: name for name in SPECIALISTS}, "human": "human", "end": END})
    graph.add_edge("human", END)

    final = graph.compile().invoke({"answered": {}, "route": [], "hops": 0, "next": "",
                                    "asked_for": "", "outcome": ""})
    return json.dumps({"outcome": final["outcome"], "route": final["route"],
                       "answers": final["answered"]})

import json
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

SPECIALISTS = {"billing": "billing_lookup", "network": "network_status",
               "plan_change": "plan_options"}


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
    answered: dict
    route: list
    next: str
    hops: int


def run_agent(question: str, llm, tools: dict) -> str:
    chat = json.loads(question)

    def supervisor(state):
        reply = llm(supervisor_prompt(chat["message"], state["answered"], []))
        return {"next": reply.split(":", 1)[1].strip(), "hops": state["hops"] + 1}

    def specialist(name):
        def answer(state):
            result = tools[SPECIALISTS[name]](account=chat["account"])
            return {"answered": {**state["answered"], name: json.dumps(result)},
                    "route": state["route"] + [name]}
        return answer

    def pick(state):
        if state["next"] == "done" or state["hops"] >= 3:
            return END
        return state["next"]

    graph = StateGraph(State)
    graph.add_node("supervisor", supervisor)
    for name in SPECIALISTS:
        graph.add_node(name, specialist(name))
        graph.add_edge(name, "supervisor")
    graph.add_edge(START, "supervisor")
    graph.add_conditional_edges("supervisor", pick,
                                {"billing": "billing", "network": "network",
                                 "plan_change": "plan_change", END: END})

    final = graph.compile().invoke({"answered": {}, "route": [], "next": "", "hops": 0})
    outcome = "completed" if final["next"] == "done" else "partial"
    return json.dumps({"outcome": outcome, "route": final["route"], "answers": final["answered"]})

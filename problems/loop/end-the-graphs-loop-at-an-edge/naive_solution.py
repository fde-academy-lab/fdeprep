import json
import re
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.DOTALL)
FINAL = re.compile(r"^Final:\s*(.+)$", re.DOTALL)


class State(TypedDict):
    calls: int
    history: list
    last: dict
    answer: str


def read_reply(reply: str) -> dict:
    text = (reply or "").strip()
    final = FINAL.match(text)
    if final:
        return {"final": final.group(1).strip()}
    action = ACTION.match(text)
    if action:
        try:
            args = json.loads(action.group(2) or "{}")
        except ValueError:
            args = None
        if isinstance(args, dict):
            return {"tool": action.group(1), "args": args}
    return {"tool": "", "args": {}}


def prompt(question: str, history: list) -> str:
    lines = [f"Request: {question}"]
    for step in history:
        lines.append(f"Observed: {step['tool']} {json.dumps(step['args'], sort_keys=True)}"
                     f" -> {json.dumps(step['result'], sort_keys=True)}")
    lines.append("Reply 'Action: <tool>(<JSON arguments>)' or 'Final: <answer>'.")
    return "\n".join(lines)


def run_agent(question: str, llm, tools: dict) -> str:
    max_calls = tools["limits"]()["max_calls"]

    def plan(state):
        reply = read_reply(llm(prompt(question, state["history"])))
        return {"calls": state["calls"] + 1, "last": reply, "answer": reply.get("final", "")}

    def act(state):
        last = state["last"]
        if "tool" not in last:
            return {}
        return {"last": {**last, "result": tools[last["tool"]](**last["args"])}}

    def observe(state):
        if "tool" not in state["last"]:
            return {}
        return {"history": state["history"] + [state["last"]]}

    def route(state):
        if state["calls"] >= max_calls:
            return END
        if "final" in state["last"]:
            return END
        return "plan"

    graph = StateGraph(State)
    graph.add_node("plan", plan)
    graph.add_node("act", act)
    graph.add_node("observe", observe)
    graph.add_edge(START, "plan")
    graph.add_edge("plan", "act")
    graph.add_edge("act", "observe")
    graph.add_conditional_edges("observe", route)
    app = graph.compile()

    try:
        state = app.invoke({"calls": 0, "history": [], "last": {}, "answer": ""},
                           {"recursion_limit": 3 * max_calls + 2})
    except Exception:
        return json.dumps({"outcome": "backstop", "answer": "", "calls": 0, "steps": 0})

    outcome = "budget" if state["calls"] >= max_calls else "final"
    answer = state["answer"]
    if not answer and state["history"]:
        answer = (f"Stopped after {state['calls']} model calls. "
                  f"Last result: {json.dumps(state['history'][-1]['result'], sort_keys=True)}")
    return json.dumps({"outcome": outcome, "answer": answer,
                       "calls": state["calls"], "steps": 3 * state["calls"]})

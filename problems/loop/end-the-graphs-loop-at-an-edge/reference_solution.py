import json
import re
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import GraphRecursionError
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


def stop_reason(state: dict, max_calls: int):
    """The edge's rule, in the contract's order. None means go round again."""
    last = state["last"]
    if "final" in last:
        return "final"
    history = state["history"]
    if len(history) >= 2 and history[-1] == history[-2]:
        return "stuck"
    if last.get("refused") or state["calls"] >= max_calls:
        return "budget"
    return None


def run_agent(question: str, llm, tools: dict) -> str:
    limits = tools["limits"]()
    max_calls = int(limits["max_calls"])
    # A run the edge ends on its last allowed call takes 3 * max_calls
    # super-steps, and LangGraph raises on reaching the limit even when the
    # next edge is END, so the backstop sits above that.
    backstop = int(limits.get("recursion_limit") or 3 * max_calls + 2)

    def plan(state):
        calls = state["calls"] + 1
        try:
            reply = read_reply(llm(prompt(question, state["history"])))
        except Exception:  # the platform refused the call; it still counts
            return {"calls": calls, "last": {"refused": True}}
        return {"calls": calls, "last": reply, "answer": reply.get("final", "")}

    def act(state):
        last = state["last"]
        if "tool" not in last:
            return {}
        tool = tools.get(last["tool"])
        try:
            result = tool(**last["args"]) if tool else {"error": f"no tool named {last['tool']!r}"}
        except Exception as exc:  # an observation, never an exception out of the graph
            result = {"error": f"{type(exc).__name__}: {exc}"}
        return {"last": {**last, "result": result}}

    def observe(state):
        if "tool" not in state["last"]:
            return {}
        return {"history": state["history"] + [state["last"]]}

    graph = StateGraph(State)
    graph.add_node("plan", plan)
    graph.add_node("act", act)
    graph.add_node("observe", observe)
    graph.add_edge(START, "plan")
    graph.add_edge("plan", "act")
    graph.add_edge("act", "observe")
    graph.add_conditional_edges(
        "observe", lambda state: END if stop_reason(state, max_calls) else "plan")
    app = graph.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": question}, "recursion_limit": backstop}

    outcome = None
    try:
        app.invoke({"calls": 0, "history": [], "last": {}, "answer": ""}, config)
    except GraphRecursionError:
        outcome = "backstop"
    snapshot = app.get_state(config)
    state, steps = snapshot.values, snapshot.metadata["step"]
    outcome = outcome or stop_reason(state, max_calls)

    history = state["history"]
    found = json.dumps(history[-1]["result"], sort_keys=True) if history else "null"
    if outcome == "final":
        answer = state["answer"]
    elif outcome == "stuck":
        answer = f"Stopped: {history[-1]['tool']} returned the same result twice. Last result: {found}"
    elif outcome == "budget":
        answer = f"Stopped after {state['calls']} model calls without an answer. Last result: {found}"
    else:
        answer = f"Stopped by the backstop after {steps} super-steps. Last result: {found}"
    return json.dumps({"outcome": outcome, "answer": answer,
                       "calls": state["calls"], "steps": steps})

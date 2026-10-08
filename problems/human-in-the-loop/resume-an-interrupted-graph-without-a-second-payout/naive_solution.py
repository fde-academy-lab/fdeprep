"""What an unprepared learner writes in four minutes.

It ports the plain agent loop into one LangGraph node: ask the model, pause at
`interrupt()` for the manager, run the step, and go round the same node again.
The brief warned about a tool above the interrupt, and there is none here. The
model call is above it, so every resume asks the model again, and the step that
runs under the manager's approval is whatever the model says the second time.

It keeps the record the way a chat keeps messages. The model's proposal goes
in, and the manager's edit goes in after it, so the model goes on reading the
figure the manager replaced. And it resumes with whatever the approvals
service hands back next, for whichever step happens to be paused.
"""

import json
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt


class State(TypedDict):
    history: list
    n: int
    ran: list
    done: str


def run_agent(question: str, llm, tools: dict) -> str:
    job = json.loads(question)

    def step(state):
        reply = llm("\n".join(state["history"]) + "\nReply with the next Step, or Done.").strip()
        if reply.startswith("Done:"):
            return {"done": reply[len("Done:"):].strip()}
        proposal = json.loads(reply[len("Step:"):])
        n = state["n"] + 1
        decision = interrupt({"step": n, "proposal": proposal})
        history = state["history"] + [f"Model: {reply}"]
        if decision["type"] == "reject":
            return {"n": n, "history": history + [
                f"Rejected: {proposal['tool']} {json.dumps(proposal['args'])}: "
                f"{decision.get('message', '')}"]}
        args = decision.get("args") or proposal["args"]
        tools[proposal["tool"]](**args)
        return {"n": n, "ran": state["ran"] + [proposal["tool"]],
                "history": history + [f"Manager: {decision['type']}",
                                      f"Ran: {proposal['tool']} {json.dumps(args)}"]}

    graph = StateGraph(State)
    graph.add_node("step", step)
    graph.add_edge(START, "step")
    graph.add_conditional_edges("step", lambda state: END if state["done"] else "step")
    app = graph.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": job["run"]}}

    state = app.invoke({"history": [f"Request: {job['request']}"], "n": 0, "ran": [], "done": ""},
                       config)
    while "__interrupt__" in state:
        state = app.invoke(Command(resume=tools["decisions"](run=job["run"])), config)
    return json.dumps({"outcome": "completed", "ran": state["ran"], "refused": [],
                       "summary": state["done"]})

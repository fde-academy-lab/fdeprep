"""Reference solution for resume-an-interrupted-graph-without-a-second-payout.

In langgraph 1.2.12 a resumed graph starts the interrupted node again from its
first line, so whatever sits above `interrupt()` runs once before the pause and
once more on the resume. The pause therefore gets a node of its own, with
`interrupt()` as its first line. The model is asked in the node before it and
the step runs in the node after it, so a resume repeats nothing that costs a
call or changes the world, and the step that runs is the one the manager saw.

The record the model reads holds each step as it settled: what ran, with the
arguments it ran with, what was rejected and why, what was refused. An edit
replaces the proposal because the proposal never enters the record.

The approvals service delivers at least once, so the driver holds every
decision up to the run and the step that is paused before it resumes. Anything
else stops the run, and the checkpoint still says what ran.
"""

import json
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

MAX_CALLS = 5


def read_reply(reply: str):
    """{"done": text}, {"tool": name, "args": {...}}, or None for anything else."""
    text = str(reply or "").strip()
    if text.startswith("Done:"):
        return {"done": text[len("Done:"):].strip()}
    if text.startswith("Step:"):
        try:
            step = json.loads(text[len("Step:"):])
        except ValueError:
            return None
        if (isinstance(step, dict) and isinstance(step.get("tool"), str)
                and isinstance(step.get("args", {}), dict)):
            return {"tool": step["tool"], "args": step.get("args") or {}}
    return None


class State(TypedDict):
    lines: list      # the record the model reads
    calls: int       # model calls asked for, re-asks included
    step: int        # steps that have paused
    proposal: dict   # the step waiting for a decision, or {}
    decision: dict
    ran: list
    refused: list
    tried: list      # every tool called in this run, one that raised included
    outcome: str
    summary: str


def problem_with(decision, run: str, paused: int):
    """Why this decision cannot settle the paused step, or None when it can."""
    if not isinstance(decision, dict) or decision.get("run") != run:
        return "The decision is not for this run."
    if decision.get("step") != paused:
        return f"Step {paused} is paused, and the decision is for step {decision.get('step')}."
    kind = decision.get("type")
    if kind in ("approve", "reject") or (kind == "edit" and isinstance(decision.get("args"), dict)):
        return None
    return "The decision is not an approve, an edit with args, or a reject."


def run_agent(question: str, llm, tools: dict) -> str:
    job = json.loads(question)
    run = job["run"]

    def propose(state):
        if state["calls"] >= MAX_CALLS:
            return {"outcome": "needs_person", "summary": f"No Done after {MAX_CALLS} model calls."}
        calls = state["calls"] + 1
        reply = read_reply(llm("\n".join(state["lines"]) + "\nReply with the next Step, or Done."))
        if reply is None:
            return {"calls": calls, "outcome": "needs_person",
                    "summary": "The model replied with neither a step nor Done."}
        if "done" in reply:
            return {"calls": calls, "outcome": "completed", "summary": reply["done"]}
        if reply["tool"] in state["tried"]:  # never twice in a run, whatever the arguments
            return {"calls": calls, "refused": state["refused"] + [reply["tool"]],
                    "lines": state["lines"] + [f"Refused: {reply['tool']}: it already ran in this run"]}
        step = state["step"] + 1
        return {"calls": calls, "step": step, "proposal": {"step": step, **reply}}

    def approve(state):
        # The first line of the node: on a resume, nothing above it runs again.
        proposal = state["proposal"]
        return {"decision": interrupt({"step": proposal["step"],
                                       "proposal": {"tool": proposal["tool"],
                                                    "args": proposal["args"]}})}

    def act(state):
        proposal, decision = state["proposal"], state["decision"]
        tool = proposal["tool"]
        if decision["type"] == "reject":
            line = (f"Rejected: {tool} {json.dumps(proposal['args'], sort_keys=True)}: "
                    f"{decision.get('message', '')}")
            return {"proposal": {}, "lines": state["lines"] + [line]}
        args = decision["args"] if decision["type"] == "edit" else proposal["args"]
        tried = state["tried"] + [tool]
        try:
            tools[tool](**args)
        except Exception as exc:  # it may have done its work, so it is never called again
            return {"proposal": {}, "tried": tried, "outcome": "needs_person",
                    "summary": f"{tool} raised {type(exc).__name__}: {exc}. It was not retried, "
                               "so check whether it took effect before this run goes on."}
        return {"proposal": {}, "tried": tried, "ran": state["ran"] + [tool],
                "lines": state["lines"] + [f"Ran: {tool} {json.dumps(args, sort_keys=True)}"]}

    graph = StateGraph(State)
    graph.add_node("propose", propose)
    graph.add_node("approve", approve)
    graph.add_node("act", act)
    graph.add_edge(START, "propose")
    graph.add_conditional_edges(
        "propose",
        lambda state: END if state["outcome"] else "approve" if state["proposal"] else "propose")
    graph.add_edge("approve", "act")
    graph.add_conditional_edges("act", lambda state: END if state["outcome"] else "propose")
    app = graph.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": run}}

    state = app.invoke({"lines": [f"Request: {job['request']}"], "calls": 0, "step": 0,
                        "proposal": {}, "decision": {}, "ran": [], "refused": [], "tried": [],
                        "outcome": "", "summary": ""}, config)
    while "__interrupt__" in state:
        paused = state["__interrupt__"][0].value["step"]
        decision = tools["decisions"](run=run)
        problem = problem_with(decision, run, paused)
        if problem:  # run nothing more; the checkpoint still says what ran
            state = {**app.get_state(config).values, "outcome": "needs_person", "summary": problem}
            break
        state = app.invoke(Command(resume=decision), config)
    return json.dumps({key: state[key] for key in ("outcome", "ran", "refused", "summary")})

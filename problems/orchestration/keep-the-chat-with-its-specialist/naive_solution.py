import json
import re
from typing import TypedDict

from langgraph.graph import START, StateGraph
from langgraph.types import Command

AGENTS = ("triage", "flights", "hotels", "refunds")
TOOL = {"flights": "flight_status", "hotels": "hotel_status", "refunds": "refund_status"}
REPLY = re.compile(r"^(Answer|Close|Handoff):\s*(.+)$", re.DOTALL)


def agent_prompt(name: str, message: str, facts: str, note: str) -> str:
    lines = [f"Agent: {name}", f"Customer: {message}"]
    if facts:
        lines.append(f"Facts: {facts}")
    if note:
        lines.append(note)
    lines.append("Reply with one line: Answer: <reply>, Close: <reply> when the case is "
                 "finished, or Handoff: <agent> | <one line for that agent>.")
    return "\n".join(lines)


def read_reply(reply: str):
    match = REPLY.match((reply or "").strip())
    if not match:
        return None
    kind, text = match.group(1).lower(), match.group(2).strip()
    if kind != "handoff":
        return (kind, text)
    agent, sep, line = text.partition("|")
    return ("handoff", (agent.strip(), line.strip())) if sep else None


class Chat(TypedDict):
    message: str
    note: str
    handoffs: int
    reply: str
    answered_by: str


def run_agent(question: str, llm, tools: dict) -> str:
    chat = json.loads(question)

    def agent(name):
        def node(state):
            facts = ""
            if name in TOOL:
                facts = json.dumps(tools[TOOL[name]](booking=chat["booking"]))
            read = read_reply(llm(agent_prompt(name, state["message"], facts, state["note"])))
            if read and read[0] == "handoff":
                target, line = read[1]
                return Command(goto=target, update={"note": line, "handoffs": state["handoffs"] + 1})
            return {"reply": read[1] if read else "", "answered_by": name}
        return node

    graph = StateGraph(Chat)
    for name in AGENTS:
        graph.add_node(name, agent(name))
    graph.add_edge(START, "triage")
    app = graph.compile()

    replies, agents, handoffs = [], [], 0
    for message in chat["turns"]:
        out = app.invoke({"message": message, "note": "", "handoffs": 0})
        replies.append(out["reply"])
        agents.append(out["answered_by"])
        handoffs += out["handoffs"]
    return json.dumps({"replies": replies, "agents": agents, "handoffs": handoffs})

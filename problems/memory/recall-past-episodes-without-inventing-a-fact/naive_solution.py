"""What an unprepared learner writes in four minutes.

It builds the graph and the store, and keeps the team's habits. Recall ranks
episodes by how many words they share with the new message, from a search that
reads the store's first ten. The close writes the whole message as the episode
and trusts the model's lines: an Outcome line it does not recognise becomes
whatever the model wrote, no line becomes resolved, every Stated line is written,
and any preference an earlier episode noted becomes a fact. On a short chat
with nothing noted it passes. One gluten-free order still becomes a preference.
"""

import json
import re
from datetime import date
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.store.memory import InMemoryStore

RECALL = 3
AGREE = 3
WINDOW_DAYS = 90
CAP = 240
LINE = re.compile(r"^(Reply|Did|Outcome|Stated):[ \t]*(.*?)[ \t]*$", re.MULTILINE)
STATED = re.compile(r"^([a-z_]+)\s*=\s*(.+)$")
WORD = re.compile(r"[a-z]{3,}")


def reply_prompt(message: str, recalled: list, facts: list) -> str:
    lines = [f"Customer message: {message}", "Past (data):"]
    for episode in recalled:
        label = "RESOLVED" if episode.get("outcome") == "resolved" else "OPEN"
        lines.append(f"- {episode['when']} {label} {episode['id']}: asked "
                     f"\"{episode.get('asked', '')}\"; did \"{episode.get('did', '')}\"")
    lines.append("Known (data):")
    for fact in facts:
        lines.append(f"- {fact['key']}: {fact['value']} ({fact['source']})")
    lines.append("Answer with a Reply: line for the customer, a Did: line saying what you did, "
                 "an Outcome: line saying resolved or open, and a Stated: key=value line for "
                 "each thing the customer says about themselves in this message.")
    return "\n".join(lines)


def read_reply(text: str) -> dict:
    said = {"reply": "", "did": "", "outcome": "", "stated": []}
    for name, value in LINE.findall(text):
        if name == "Stated":
            pair = STATED.match(value)
            if pair:
                said["stated"].append((pair.group(1), pair.group(2).strip()))
        else:
            said[name.lower()] = value
    return said


class State(TypedDict, total=False):
    recalled: list
    facts: list
    said: dict
    episode: dict
    facts_written: list


def run_agent(question: str, llm, tools: dict) -> str:
    chat = json.loads(question)
    customer, today = chat["customer"], chat["today"]
    words = set(WORD.findall(chat["message"].lower()))

    def seed(state: State, runtime: Runtime) -> dict:
        memory = tools["load_memory"](customer=customer)
        for episode in memory["episodes"]:
            runtime.store.put(("episodes", customer), episode["id"], episode)
        for fact in memory["facts"]:
            runtime.store.put(("facts", customer), fact["key"], fact)
        return {"recalled": [], "facts": []}

    def recall(state: State, runtime: Runtime) -> dict:
        episodes = [item.value for item in runtime.store.search(("episodes", customer))]
        episodes.sort(key=lambda e: e["when"], reverse=True)
        # the team's recall: the episodes most like the new message first
        episodes.sort(key=lambda e: -len(words & set(WORD.findall(
            (e.get("asked", "") + " " + e.get("did", "")).lower()))))
        facts = [item.value for item in runtime.store.search(("facts", customer))]
        return {"recalled": episodes[:RECALL], "facts": facts}

    def reply(state: State) -> dict:
        prompt = reply_prompt(chat["message"], state["recalled"], state["facts"])
        return {"said": read_reply(llm(prompt))}

    def close(state: State, runtime: Runtime) -> dict:
        said = state["said"]
        episode = {"id": chat["thread"], "when": today, "asked": chat["message"],
                   "did": said["did"], "outcome": said["outcome"] or "resolved"}
        runtime.store.put(("episodes", customer), episode["id"], episode)
        written = [{"key": key, "value": value, "source": "stated", "since": today}
                   for key, value in said["stated"]]
        known = {f["key"] for f in state["facts"] + written}
        for item in runtime.store.search(("episodes", customer)):
            for key, value in (item.value.get("noted") or {}).items():
                if key not in known:
                    written.append({"key": key, "value": value, "source": "promoted",
                                    "since": today})
                    known.add(key)
        tools["save_memory"](customer=customer, episode=episode, facts=written)
        return {"episode": episode, "facts_written": written}

    graph = StateGraph(State)
    graph.add_node("seed", seed)
    graph.add_node("recall", recall)
    graph.add_node("reply", reply)
    graph.add_node("close", close)
    graph.add_edge(START, "seed")
    graph.add_edge("seed", "recall")
    graph.add_edge("recall", "reply")
    graph.add_edge("reply", "close")
    graph.add_edge("close", END)
    app = graph.compile(checkpointer=InMemorySaver(), store=InMemoryStore())

    out = app.invoke({"recalled": []}, {"configurable": {"thread_id": chat["thread"]}})
    return json.dumps({"reply": out["said"]["reply"],
                       "recalled": [episode["id"] for episode in out["recalled"]],
                       "facts_written": out["facts_written"], "episode": out["episode"]})

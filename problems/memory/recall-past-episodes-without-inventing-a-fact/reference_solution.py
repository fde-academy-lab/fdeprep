"""Reference solution for recall-past-episodes-without-inventing-a-fact.

An episode is something that happened: a date, what was asked, what was done
and whether it was resolved. A fact is something the agent may rely on, and it
earns that by the customer saying it or by three recent episodes agreeing.
The graph keeps both in a LangGraph store, keyed by the customer, so they
outlive the chat's own thread.

Recall puts what is still open first, whatever its age, then the newest, and
reads every episode before it chooses. The close writes this chat as an
episode that is open unless the model says it was resolved, checks each fact
the model says the customer stated against the customer's own message, and
promotes a fact only on three agreeing episodes from the last 90 days.
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
    episodes_ns, facts_ns = ("episodes", customer), ("facts", customer)

    def seed(state: State, runtime: Runtime) -> dict:
        try:
            memory = tools["load_memory"](customer=customer)
        except Exception:
            memory = None
        memory = memory if isinstance(memory, dict) else {}  # unreadable memory is a new customer
        for episode in memory.get("episodes") or []:
            runtime.store.put(episodes_ns, episode["id"], episode)
        for fact in memory.get("facts") or []:
            runtime.store.put(facts_ns, fact["key"], fact)
        return {"recalled": [], "facts": []}

    def recall(state: State, runtime: Runtime) -> dict:
        # search stops at ten items unless told otherwise, in the order they were put
        episodes = [item.value for item in runtime.store.search(episodes_ns, limit=10_000)]
        episodes.sort(key=lambda e: e["when"], reverse=True)
        episodes.sort(key=lambda e: e.get("outcome") == "resolved")  # open first, stays newest first
        facts = [item.value for item in runtime.store.search(facts_ns, limit=10_000)
                 if item.value.get("source") in ("stated", "promoted")]
        return {"recalled": episodes[:RECALL], "facts": facts}

    def reply(state: State) -> dict:
        prompt = reply_prompt(chat["message"], state["recalled"], state["facts"])
        return {"said": read_reply(llm(prompt))}

    def close(state: State, runtime: Runtime) -> dict:
        said = state["said"]
        episode = {"id": chat["thread"], "when": today, "asked": chat["message"][:CAP],
                   "did": said["did"][:CAP],
                   "outcome": "resolved" if said["outcome"] == "resolved" else "open"}
        runtime.store.put(episodes_ns, episode["id"], episode)

        written = [{"key": key, "value": value, "source": "stated", "since": today}
                   for key, value in said["stated"]
                   if value.lower() in chat["message"].lower()]
        stated = {f["key"] for f in written + state["facts"] if f["source"] == "stated"}
        known = {(f["key"], f["value"]) for f in state["facts"]}
        agree = {}
        for item in runtime.store.search(episodes_ns, limit=10_000):
            age = (date.fromisoformat(today) - date.fromisoformat(item.value["when"])).days
            if age <= WINDOW_DAYS:
                for pair in (item.value.get("noted") or {}).items():
                    agree[pair] = agree.get(pair, 0) + 1
        for (key, value), count in sorted(agree.items()):
            if count >= AGREE and key not in stated and (key, value) not in known:
                written.append({"key": key, "value": value, "source": "promoted", "since": today})

        for fact in written:
            runtime.store.put(facts_ns, fact["key"], fact)
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

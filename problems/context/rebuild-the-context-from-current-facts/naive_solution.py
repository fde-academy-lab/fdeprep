"""What an unprepared learner writes in four minutes.

It rebuilds instead of appending, keeps only verified results, carries the
open tasks and the last six turns, which is most of the contract. It walks
the log in the order it was written and lets each result replace the one
before it, so the result written last wins, and a retried call that writes an
old answer late puts that old answer back on the fact line.
"""

import json
import re

INSTRUCTIONS = (
    "You are the broadband support agent. Answer from the open tasks and the "
    "facts below. Each fact is the newest verified result on its subject."
)


def run_agent(question: str, llm, tools: dict) -> str:
    events = (tools["session"]() or {}).get("events") or []

    facts, tasks = {}, {}
    for event in events:
        if event.get("kind") == "result" and event.get("verified"):
            facts[event["key"]] = event
        elif event.get("kind") == "task":
            tasks[event["task"]] = event

    open_tasks = sorted(task for task, event in tasks.items() if event.get("state") == "open")
    turns = [event for event in events if event.get("kind") == "turn"][-6:]

    lines = [INSTRUCTIONS]
    lines += [f"open task {task}: {tasks[task]['text']}" for task in open_tasks]
    lines += [f"fact {key}: {facts[key]['text']}" for key in sorted(facts)]
    lines += [f"{event['role']}: {event['text']}" for event in turns]
    lines.append(f"customer: {question}")

    reply = llm("\n".join(lines)).strip()
    return json.dumps({
        "answer": reply,
        "facts": {key: facts[key]["id"] for key in sorted(facts)},
        "open_tasks": open_tasks,
    })

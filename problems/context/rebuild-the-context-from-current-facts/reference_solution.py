"""Reference solution for rebuild-the-context-from-current-facts.

The prompt is rebuilt from the session log before every call instead of
being appended to. Each subject gets one fact line, from the verified result
observed last. Observed means when the result was true, read as a moment in
time, because the log's own order is the order results were written and a
retried call writes an old answer late, and because two systems write their
offsets differently.

Results are filtered to verified ones before the newest is chosen. Choosing
first and filtering after finds a customer's claim, rejects it, and leaves no
fact at all.

Open tasks stay however old they are, since they are the reason the session
exists. Turns go the other way: only the last six, because an old turn
repeats facts as they stood when it was said.

The open decision: a result that is not verified is left out of the prompt.
The customer's own words are already in the recent turns, and a claim shown
next to the facts invites the model to weigh the two as equals.
"""

import json
import re
from datetime import datetime

INSTRUCTIONS = (
    "You are the broadband support agent. Answer from the open tasks and the "
    "facts below. Each fact is the newest verified result on its subject."
)
RECENT_TURNS = 6


def moment(value):
    """observed_at as a time with an offset, or None when it cannot be placed."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.utcoffset() is not None else None


def observed_last(events: list):
    """The event observed last; at the same moment, the one later in the log."""
    best, best_at = None, None
    for event in events:
        at = moment(event.get("observed_at"))
        if at is not None and (best_at is None or at >= best_at):
            best, best_at = event, at
    return best


def run_agent(question: str, llm, tools: dict) -> str:
    log = tools["session"]() or {}
    events = [event for event in (log.get("events") or []) if isinstance(event, dict)]
    results = [event for event in events if event.get("kind") == "result"]
    task_events = [event for event in events if event.get("kind") == "task"]

    facts = {}
    for key in sorted({str(event.get("key")) for event in results if event.get("key")}):
        verified = [event for event in results
                    if str(event.get("key")) == key and event.get("verified") is True]
        winner = observed_last(verified)
        if winner is not None:
            facts[key] = winner

    open_tasks = {}
    for task in sorted({str(event.get("task")) for event in task_events if event.get("task")}):
        latest = observed_last([event for event in task_events if str(event.get("task")) == task])
        if latest is not None and latest.get("state") == "open":
            open_tasks[task] = latest

    turns = [event for event in events if event.get("kind") == "turn"][-RECENT_TURNS:]

    lines = [INSTRUCTIONS]
    lines += [f"open task {task}: {event.get('text', '')}" for task, event in open_tasks.items()]
    lines += [f"fact {key}: {event.get('text', '')}" for key, event in facts.items()]
    lines += [f"{event.get('role', 'customer')}: {event.get('text', '')}" for event in turns]
    lines.append(f"customer: {question}")

    reply = llm("\n".join(lines)).strip()
    return json.dumps({
        "answer": reply,
        "facts": {key: event.get("id") for key, event in facts.items()},
        "open_tasks": list(open_tasks),
    })

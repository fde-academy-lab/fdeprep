"""Reference solution for merge-three-memory-stores-for-one-question.

Each store is asked in its own terms. A note's score counts matching words
and an index result's score is a similarity under 1, so no number from one
can rank the other. Each store gets its own floor, which matters most for
the index, since it returns its nearest neighbours however far away they
are, and its own order, highest first and then by id so ties never depend
on arrival. The merge takes turns, index first, so neither store can fill
the context alone. A memory saved in both stores counts once, at its first
place in that order, before the cut to four.

The profile is the record for its fields, so a memory about a field the
profile returned is dropped. The open decision: when the profile could not
be read, memories about its fields are kept. They are the best evidence the
firm has at that moment, and the Skipped line tells the model the record
itself was not checked.

A store that contributed nothing is named with the reason, because "the
client never said" and "we could not look" lead to different answers.
"""

import json
import re

NOTE_FLOOR = 2
INDEX_FLOOR = 0.75
LIMIT = 4


def ask(tool, field: str, kind, **kwargs):
    """The store's answer under field, or None when the store is unavailable."""
    try:
        answer = tool(**kwargs)
    except Exception:
        return None
    if not isinstance(answer, dict) or answer.get("status") != 200 or answer.get("error"):
        return None
    value = answer.get(field)
    return value if isinstance(value, kind) else None


def ranked(items: list, score: str, floor: float) -> list:
    """The items at or above floor, highest score first, then by id."""
    passing = [item for item in items
               if isinstance(item, dict) and isinstance(item.get(score), (int, float))
               and not isinstance(item.get(score), bool) and item[score] >= floor]
    return sorted(passing, key=lambda item: (-item[score], str(item.get("id"))))


def taking_turns(first: list, second: list) -> list:
    merged = []
    for position in range(max(len(first), len(second))):
        merged += [store[position] for store in (first, second) if position < len(store)]
    return merged


def same_text(text) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text).lower())


def run_agent(question: str, llm, tools: dict) -> str:
    fields = ask(tools["profile"], "fields", dict)
    hits = ask(tools["notes"], "hits", list, query=question)
    results = ask(tools["index"], "results", list, query=question)

    def not_overruled(memory: dict) -> bool:
        return not (fields and memory.get("about") in fields)

    notes = [hit for hit in ranked(hits or [], "matched", NOTE_FLOOR) if not_overruled(hit)]
    index = [result for result in ranked(results or [], "similarity", INDEX_FLOOR)
             if not_overruled(result)]

    memories, seen = [], set()
    for memory in taking_turns(index, notes):
        text = same_text(memory.get("text"))
        if text in seen:
            continue
        seen.add(text)
        memories.append(memory)
    memories = memories[:LIMIT]
    chosen = {str(memory.get("id")) for memory in memories}

    skipped = {}
    for store, answer, kept in (("profile", fields, fields),
                                ("notes", hits, [m for m in notes if str(m.get("id")) in chosen]),
                                ("index", results, [m for m in index if str(m.get("id")) in chosen])):
        if answer is None:
            skipped[store] = "unavailable"
        elif not kept:
            skipped[store] = "nothing_relevant"

    lines = ["Profile:"]
    lines += [f"{field}: {fields[field]}" for field in sorted(fields or {})] or ["- none"]
    lines.append("Memories:")
    lines += [f"[{memory.get('id')}] {memory.get('text', '')}" for memory in memories] or ["- none"]
    if skipped:
        lines.append("Skipped: " + ", ".join(f"{store} ({reason})" for store, reason in skipped.items()))
    lines.append(f"Question: {question}")

    reply = llm("\n".join(lines)).strip()
    return json.dumps({
        "answer": reply,
        "memories": [memory.get("id") for memory in memories],
        "skipped": skipped,
    })

"""Reference solution for pack-the-window-without-cutting-items.

The window is spent by priority, in whole items. Instructions are pinned.
Tool results come next, newest first, because they are the facts an answer
has to quote; then turns, newest first; then passages by rank. An item that
does not fit is left out whole and the next one is tried, so a short rule is
not lost behind a long page. Turns are the exception: once one is left out,
no older one is taken, because an older turn read without the newer ones can
ask for something the passenger has taken back.

The Left out line is part of the prompt, so it is paid for out of the same
window. It exists only when something was left out, which is only known
after packing, so a packing that leaves anything out runs again with
NOTE_TOKENS less room.

An item whose token count cannot be read is treated as too big. Free is the
one cost it certainly does not have.
"""

import json
import re

NOTE_TOKENS = 10


def cost(item: dict):
    """The item's tokens, or None when they cannot be read."""
    tokens = item.get("tokens")
    if isinstance(tokens, bool) or not isinstance(tokens, int) or tokens <= 0:
        return None
    return tokens


def newest_first(items: list, kind: str) -> list:
    return [item for item in reversed(items) if item.get("kind") == kind]


def best_rank_first(items: list) -> list:
    passages = [item for item in items if item.get("kind") == "passage"]
    return sorted(passages, key=lambda item: (item.get("rank", 10 ** 6), str(item.get("id"))))


def pack(items: list, room: int) -> set:
    """The ids taken into room, by the desk's priority, whole items only."""
    taken = set()
    for item in newest_first(items, "tool_result"):
        tokens = cost(item)
        if tokens is not None and tokens <= room:
            taken.add(item["id"])
            room -= tokens
    for item in newest_first(items, "turn"):
        tokens = cost(item)
        if tokens is None or tokens > room:
            break  # no older turn may be read without this one
        taken.add(item["id"])
        room -= tokens
    for item in best_rank_first(items):
        tokens = cost(item)
        if tokens is not None and tokens <= room:
            taken.add(item["id"])
            room -= tokens
    return taken


def run_agent(question: str, llm, tools: dict) -> str:
    context = tools["context"]() or {}
    window = int(context.get("window") or 0)
    items = [item for item in (context.get("items") or []) if isinstance(item, dict)]

    instructions = [item for item in items if item.get("kind") == "instruction"]
    others = [item for item in items if item.get("kind") != "instruction"]
    room = window - sum(cost(item) or 0 for item in instructions)

    taken = pack(others, room)
    if len(taken) < len(others):
        # Something is left out, so the note is needed and is paid for first.
        taken = pack(others, room - NOTE_TOKENS)

    kept = instructions + [item for item in others if item["id"] in taken]
    left_out = [item["id"] for item in others if item["id"] not in taken]

    lines = [f"[{item['id']}] {item.get('text', '')}" for item in kept]
    if left_out:
        lines.append("Left out: " + ", ".join(left_out))
    lines.append(f"Question: {question}")

    reply = llm("\n".join(lines)).strip()
    return json.dumps({
        "answer": reply,
        "included": [item["id"] for item in kept],
        "left_out": left_out,
    })

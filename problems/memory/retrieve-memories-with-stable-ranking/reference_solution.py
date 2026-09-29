"""Reference solution for retrieve-memories-with-stable-ranking.

Eligibility first: only this conversation's tenant, and nothing at all when
the tenant is unknown, because a filter with nothing to compare against has
to deny. The recall is not even made then, so no other retailer's memory
enters this process.

Then a total order. Score alone leaves ties in arrival order, and the shards
choose that order again on every call, so the id breaks every tie. Walking
that order, a second copy of a memory is skipped before it can take a slot,
and the walk stops at three.
"""

import json
import re

LIMIT = 3


def _key(text) -> str:
    """What a memory says, with case, spacing and punctuation removed."""
    return "".join(ch for ch in str(text).lower() if ch.isalnum())


def _ranked(memories: list) -> list:
    return sorted(
        memories,
        key=lambda memory: (-float(memory.get("score", 0)), str(memory.get("id", ""))),
    )


def _choose(memories: list) -> list:
    chosen, seen = [], set()
    for memory in _ranked(memories):
        key = _key(memory.get("text"))
        if key in seen:
            continue
        seen.add(key)
        chosen.append(memory)
        if len(chosen) == LIMIT:
            break
    return chosen


def _tenant(tools: dict):
    session = tools["session"]()
    return session.get("tenant") if isinstance(session, dict) else None


def _eligible(tools: dict, question: str, tenant) -> list:
    if not tenant:
        return []
    found = tools["recall"](query=question)
    memories = found.get("memories") if isinstance(found, dict) else None
    if not isinstance(memories, list):
        return []
    return [m for m in memories if isinstance(m, dict) and m.get("tenant") == tenant]


def run_agent(question: str, llm, tools: dict) -> str:
    chosen = _choose(_eligible(tools, question, _tenant(tools)))
    lines = [f"- {memory.get('text')}" for memory in chosen] or ["- none"]
    prompt = "Memories:\n" + "\n".join(lines) + f"\nQuestion: {question}"
    return llm(prompt).strip()

"""Reference solution for fit-recent-turns-around-a-pinned-policy.

The policy is pinned: it goes first and whole, and its tokens come out of the
window before any turn is considered. Trimming only ever sees the turns, so no
chat is long enough to push the policy out.

Turns are taken newest first while they fit, and the walk stops at the first
one that does not. A turn kept from beyond that gap would reach the model
without the turns that explained it.

A policy that does not fit on its own is a configuration fault. Cutting it to
fit sends a different policy, so the chat goes to a person instead and the
model is never called.
"""

import json
import re

NEEDS_A_PERSON = (
    "This conversation needs a person: the policy block does not fit in the "
    "context window."
)


def _recent_turns(turns: list, room: int) -> list:
    """The longest run of newest turns whose tokens fit in room."""
    kept = []
    for turn in reversed(turns):
        cost = int(turn.get("tokens", 0))
        if cost > room:
            break
        kept.append(turn)
        room -= cost
    kept.reverse()
    return kept


def run_agent(question: str, llm, tools: dict) -> str:
    context = tools["conversation"]() or {}
    window = int(context.get("window") or 0)
    policy = context.get("policy") or {}
    turns = context.get("turns") or []

    room = window - int(policy.get("tokens", 0))
    if room < 0:
        return NEEDS_A_PERSON

    lines = [policy.get("text", "")]
    lines += [f"{turn.get('role')}: {turn.get('text')}" for turn in _recent_turns(turns, room)]
    lines.append(f"customer: {question}")
    return llm("\n".join(lines)).strip()

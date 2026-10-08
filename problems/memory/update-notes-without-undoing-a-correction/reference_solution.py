"""Reference solution for update-notes-without-undoing-a-correction.

Every value is written with who said it, and the merge ranks by that. The
source the extraction model reports is a claim, so it is worked out again
from the transcript: a value is the traveller's only when the turn it cites
is the traveller's own and holds the value. Ranked by the model's label, any
guess could borrow the traveller's authority and overwrite a correction.

Against the value in force, the same value written differently changes
nothing. An equal or stronger value replaces it, and the old note stays as
replaced. A weaker value that disagrees is kept as a conflict, beside the
value in force, with its own source, so a person can see the disagreement.

Nothing is deleted, and a notes file that could not be read is unknown,
never empty: written back, an empty read would erase every correction.
"""

import json
import re

RANK = {"user": 2, "agent": 1}


def same_value(a, b) -> bool:
    return str(a).strip().lower() == str(b).strip().lower()


def read_list(tool, field: str):
    """(the list under field, the whole answer), or (None, None) when unreadable."""
    try:
        answer = tool()
    except Exception:
        return None, None
    if not isinstance(answer, dict) or not isinstance(answer.get(field), list):
        return None, None
    return answer[field], answer


def source_of(proposal: dict, turns: list) -> str:
    """The traveller's only when the cited turn is theirs and holds the value."""
    value = str(proposal.get("value") or "").strip().lower()
    for turn in turns:
        if isinstance(turn, dict) and turn.get("n") == proposal.get("turn"):
            if value and turn.get("role") == "traveller" and value in str(turn.get("text", "")).lower():
                return "user"
    return "agent"


def run_agent(question: str, llm, tools: dict) -> str:
    notes, _ = read_list(tools["notes"], "notes")
    turns, transcript = read_list(tools["transcript"], "turns")
    if notes is None or turns is None:
        return json.dumps({"notes": None})
    proposals, _ = read_list(tools["proposals"], "proposals")

    notes = [dict(note) for note in notes if isinstance(note, dict)]
    session = transcript.get("session")

    for proposal in proposals or []:
        if not isinstance(proposal, dict) or "key" not in proposal:
            continue
        source = source_of(proposal, turns)
        written = {"key": proposal["key"], "value": proposal.get("value"), "source": source,
                   "session": session, "turn": proposal.get("turn"), "status": "current"}
        current = next((note for note in notes
                        if note.get("key") == proposal["key"] and note.get("status") == "current"),
                       None)
        if current is None:
            notes.append(written)
        elif same_value(current.get("value"), proposal.get("value")):
            continue
        elif RANK[source] >= RANK.get(current.get("source"), 0):
            current["status"] = "replaced"
            notes.append(written)
        else:
            written["status"] = "conflict"
            notes.append(written)

    return json.dumps({"notes": notes})

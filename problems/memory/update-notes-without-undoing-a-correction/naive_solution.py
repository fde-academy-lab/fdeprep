"""What an unprepared learner writes in four minutes.

It keeps history, which is the half of the incident anyone notices: the old
value is marked replaced instead of disappearing. It still lets the proposal
written last win, takes each proposal's source from the extraction model's
own label, compares values exactly, and reads a notes file that failed to
load as an empty one.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    notes = (tools["notes"]() or {}).get("notes") or []
    session = (tools["transcript"]() or {}).get("session")
    proposals = (tools["proposals"]() or {}).get("proposals") or []

    for proposal in proposals:
        current = next((n for n in notes
                        if n["key"] == proposal["key"] and n["status"] == "current"), None)
        if current and current["value"] == proposal["value"]:
            continue
        if current:
            current["status"] = "replaced"
        notes.append({"key": proposal["key"], "value": proposal["value"],
                      "source": proposal["source"], "session": session,
                      "turn": proposal["turn"], "status": "current"})
    return json.dumps({"notes": notes})

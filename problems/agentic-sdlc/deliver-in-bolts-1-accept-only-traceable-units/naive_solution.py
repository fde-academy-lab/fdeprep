"""What an unprepared learner writes in four minutes.

It reads the brief's story, that UoW-7 traced to R-9 and the sponsor rejected
R-9, and turns it into a blocklist: a unit is rejected when it traces to a
requirement PRD v2 rejected, and accepted otherwise. UoW-7 comes back with
R-9, so the first public case passes. A unit that rests on a deferred
requirement, a withdrawn one, or nothing at all is never turned down, because
none of those ids is on the rejected list.
"""

import json

ASK = (
    "You are the construction agent in a mob elaboration session. Propose the "
    "units of work for the intent lines and the accepted PRD v2 requirements "
    "below. Reply with one JSON object and nothing else, in this shape:\n"
    '{"units": [{"id": "UoW-1", "unit": "...", "estimate_h": 6, "depends_on": [], '
    '"traces_to": ["R-1"], "done_when": "..."}]}\n'
)


def run_agent(question: str, llm, tools: dict) -> str:
    lines = tools["intent"]()
    prd = tools["prd"](version=2)
    intent = "\n".join(f"{line['id']}: {line['text']}" for line in lines)
    reply = llm(f"{ASK}{intent}\nRequirements: {', '.join(prd['accepted'])}")

    accepted, rejected = [], []
    for unit in json.loads(reply)["units"]:
        blocked = [ref for ref in unit["traces_to"] if ref in prd["rejected"]]
        if blocked:
            rejected.append({"id": unit["id"], "failed": blocked[0]})
        else:
            accepted.append(unit["id"])
    return json.dumps({"accepted": accepted, "rejected": rejected})

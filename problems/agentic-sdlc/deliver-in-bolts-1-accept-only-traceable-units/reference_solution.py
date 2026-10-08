"""Reference solution for deliver-in-bolts-1-accept-only-traceable-units.

A unit of work is built because somebody asked for it, so a trace counts only
when it points at something the sponsor accepted: an intent line, or a
requirement in PRD v2's accepted list. Every id is looked up in that one set.
A check against the rejected list instead lets through a unit that rests on a
deferred requirement, a withdrawn one, or nothing at all.

A unit that fails goes back to the session with the first id that did not
resolve, or None when it traced to nothing, so the session knows what to fix.
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
    allowed = {line["id"] for line in lines} | set(prd["accepted"])

    intent = "\n".join(f"{line['id']}: {line['text']}" for line in lines)
    reply = llm(f"{ASK}{intent}\nAccepted requirements: {', '.join(prd['accepted'])}")

    accepted, rejected = [], []
    for unit in json.loads(reply)["units"]:
        failed = next((ref for ref in unit["traces_to"] if ref not in allowed), None)
        if unit["traces_to"] and failed is None:
            accepted.append(unit["id"])
        else:
            rejected.append({"id": unit["id"], "failed": failed})
    return json.dumps({"accepted": accepted, "rejected": rejected})

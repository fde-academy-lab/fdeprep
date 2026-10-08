"""Reference solution for fund-the-agent-3-trace-every-prd-requirement.

A requirement's traces_to is a claim that somebody asked for it. The claim
holds only when every id leads to a source: a question that was answered, a
row the ledger holds, or one of the two intent lines. The first id that leads
nowhere is the reason the sponsor reads.

Conflicts are read per metric across the whole draft, because the sponsor
chooses one number for each metric however many requirements state one.
"""

import json

INTENT_LINES = ("INT-1", "INT-2")
PRD_PROMPT = (
    "Draft the PRD for the field-service agent from INT-1, INT-2, the discovery "
    "questions and the evidence ledger. Reply with one JSON object, "
    '{"requirements": [...]}, giving each requirement its id, text, metric, '
    "target and the ids it rests on."
)


def run_agent(question: str, llm, tools: dict) -> str:
    draft = json.loads(llm(PRD_PROMPT))["requirements"]
    status = {q["id"]: q["status"] for q in tools["questions"]()}
    rows = {row["id"] for row in tools["ledger"]()}

    def why_not(ref):
        """None when the id is a source, otherwise the reason it is not one."""
        if ref in rows or ref in INTENT_LINES or status.get(ref) == "answered":
            return None
        return status.get(ref, "unknown")

    accepted, unasked, by_metric = [], [], {}
    for req in draft:
        refs = req.get("traces_to") or []
        failed = next((ref for ref in refs if why_not(ref)), None)
        if not refs:
            unasked.append({"id": req["id"], "reason": "no_trace", "ref": None})
        elif failed:
            unasked.append({"id": req["id"], "reason": why_not(failed), "ref": failed})
        else:
            accepted.append(req["id"])
        if req.get("metric"):
            by_metric.setdefault(req["metric"], []).append(req)

    conflicts = [{"metric": metric, "ids": [r["id"] for r in group]}
                 for metric, group in by_metric.items()
                 if len({r["target"] for r in group}) > 1]
    return json.dumps({"in": accepted, "unasked": unasked, "conflicts": conflicts})

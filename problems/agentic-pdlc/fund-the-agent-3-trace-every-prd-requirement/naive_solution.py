"""What a learner writes after reading the first public case.

R-9 cites nothing and R-11 cites a dropped question, so this check sends
those two shapes back and keeps everything else. A question that was not
dropped passes as answered, an evidence id passes on its look because the
ledger is never read, and a conflict is a pair: the first requirement that
set a metric against each later one that sets it differently.
"""

import json

PRD_PROMPT = (
    "Draft the PRD for the field-service agent from INT-1, INT-2, the discovery "
    "questions and the evidence ledger. Reply with one JSON object, "
    '{"requirements": [...]}, giving each requirement its id, text, metric, '
    "target and the ids it rests on."
)


def run_agent(question: str, llm, tools: dict) -> str:
    draft = json.loads(llm(PRD_PROMPT))["requirements"]
    dropped = {q["id"] for q in tools["questions"]() if q["status"] == "dropped"}

    accepted, unasked, conflicts, first = [], [], [], {}
    for req in draft:
        gone = [ref for ref in req["traces_to"] if ref in dropped]
        if not req["traces_to"]:
            unasked.append({"id": req["id"], "reason": "no_trace", "ref": None})
        elif gone:
            unasked.append({"id": req["id"], "reason": "dropped", "ref": gone[0]})
        else:
            accepted.append(req["id"])
        metric = req["metric"]
        if metric in first and first[metric]["target"] != req["target"]:
            conflicts.append({"metric": metric, "ids": [first[metric]["id"], req["id"]]})
        elif metric:
            first[metric] = req
    return json.dumps({"in": accepted, "unasked": unasked, "conflicts": conflicts})

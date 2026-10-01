"""Reference solution for release-what-you-verified-and-report-the-rest.

A check answers with exactly one thing: a 200 whose pass is true or false.
Everything else, a 503, a raise, a 200 with an error in the body, a pass
written as text, is the absence of an answer, and the absence of an answer is
never a pass.

Each check has its own breaker, a count of failed calls in a row. A failed
call adds one and any answer, a refusal included, resets it, because a
refusal is the service working. At three the check is not called again for the
rest of the manifest, which is what keeps one dead service from costing every
shipment a timeout.

Only the required checks decide a shipment's status. The advisory ones are
reported, gaps and all, and decide nothing, which is the part of degradation
that keeps shipments moving while two services are down.
"""

import json

CHECKS = ("sanctions", "licence", "credit", "address")
REQUIRED = ("sanctions", "licence")
TRIES = 2            # the call and one retry, per check and shipment
BREAKER_AFTER = 3    # failed calls in a row that open a check's breaker


def _ask(tool, shipment_id: str):
    """One call: "pass", "fail", or None when the call gave no answer."""
    try:
        reply = tool(shipment=shipment_id)
    except Exception:
        return None
    if not isinstance(reply, dict) or reply.get("status") != 200:
        return None
    verdict = reply.get("pass")
    if verdict is True:
        return "pass"
    if verdict is False:
        return "fail"
    return None


def _status(row: dict) -> str:
    required = [row[check] for check in REQUIRED]
    if "fail" in required:
        return "held"
    if all(result == "pass" for result in required):
        return "released"
    return "pending"


def run_agent(question: str, llm, tools: dict) -> str:
    reply = tools["manifest"]()
    shipments = reply.get("shipments") if isinstance(reply, dict) else None

    failed_in_a_row = {check: 0 for check in CHECKS}
    answers = {}
    for shipment in shipments or []:
        row = {}
        for check in CHECKS:
            result, tried = None, 0
            while tried < TRIES and failed_in_a_row[check] < BREAKER_AFTER:
                tried += 1
                result = _ask(tools[check], shipment["id"])
                if result is not None:
                    failed_in_a_row[check] = 0
                    break
                failed_in_a_row[check] += 1
            if result is None:
                result = "down" if tried else "breaker_open"
            row[check] = result
        answers[shipment["id"]] = {"status": _status(row), **row}

    return json.dumps(answers)

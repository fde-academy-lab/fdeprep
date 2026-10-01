"""What an unprepared learner writes in four minutes.

It runs the four checks, catches a raise, and decides the status from the
required checks only, so the public cases pass. It never retries and has no
breaker, so it calls a dead service for every shipment of the night. And it
treats any 200 that does not say "pass": false as a pass, so a service that
answers 200 with an error in the body has its silence read as a yes.
"""

import json

CHECKS = ("sanctions", "licence", "credit", "address")
REQUIRED = ("sanctions", "licence")


def run_agent(question: str, llm, tools: dict) -> str:
    shipments = tools["manifest"]()["shipments"]
    answers = {}
    for shipment in shipments:
        row = {}
        for check in CHECKS:
            try:
                reply = tools[check](shipment=shipment["id"])
            except Exception:
                row[check] = "down"
                continue
            if reply.get("status") != 200:
                row[check] = "down"
            elif reply.get("pass") is False:
                row[check] = "fail"
            else:
                row[check] = "pass"

        if any(row[check] == "fail" for check in REQUIRED):
            status = "held"
        elif all(row[check] == "pass" for check in REQUIRED):
            status = "released"
        else:
            status = "pending"
        answers[shipment["id"]] = {"status": status, **row}

    return json.dumps(answers)

"""What an unprepared learner writes in four minutes.

It previews the job, which is the dry run the payments lead asked for, and
then trusts the preview completely. Every order it returned is refunded in
one pass, with no limit on the run and no look at how the first refunds went.
When the order service silently drops a filter key, the preview is the whole
sale and so are the refunds, and a refund that raises ends the run with an
exception in place of a report.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    job = tools["job"]()
    orders = tools["preview"](filter=job["filter"])["orders"]
    refunded, failed = [], []

    for order in orders:
        result = tools["refund"](order=order["order"])
        if result.get("refunded"):
            refunded.append(order["order"])
        else:
            failed.append(order["order"])

    return json.dumps({"outcome": "done", "refunded": refunded,
                       "failed": failed, "remaining": 0})

"""What an unprepared learner writes in four minutes.

It pairs each start with its end, masks the emails and card numbers it thinks
of as customer data, and hands the model its own steps for the summary. Error
messages go in whole, including the one carrying a credential and the one
carrying an entire HTML error page. A span that never ended has no end event
to look up, and the lookup raises.
"""

import json
import re

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
CARD = re.compile(r"\b(?:\d[ -]?){12,18}\d\b")


def run_agent(question: str, llm, tools: dict) -> str:
    data = tools["run_events"]()
    starts, ends = {}, {}
    for event in data["events"]:
        if event["type"] == "start":
            starts[event["span"]] = event
        else:
            ends[event["span"]] = event

    steps = []
    for n, start in enumerate(sorted(starts.values(), key=lambda e: e["at_ms"]), 1):
        end = ends[start["span"]]
        detail = start.get("detail", "")
        if end.get("detail"):
            detail += " -> " + end["detail"]
        detail = CARD.sub("[card]", EMAIL.sub("[email]", detail))
        steps.append({"n": n, "span": start["span"], "name": start["name"],
                      "ms": end["at_ms"] - start["at_ms"], "status": end["status"],
                      "detail": detail})

    outcome = "failed" if any(s["status"] == "error" for s in steps) else "succeeded"
    summary = llm("Summarise this run in one line:\n" + json.dumps(steps)).strip()
    return json.dumps({"run_id": data["run_id"], "outcome": outcome,
                       "steps": steps, "summary": summary})

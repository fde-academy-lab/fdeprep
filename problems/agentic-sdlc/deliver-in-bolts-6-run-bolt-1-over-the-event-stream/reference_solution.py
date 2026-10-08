"""Reference solution for deliver-in-bolts-6-run-bolt-1-over-the-event-stream.

Time is the bolt clock, h, so a night or a weekend inside the bolt costs
nothing. Every hour belongs to one run: a ticket from its start to its done or
parked event, a review from its request to its result. Runs are keyed by their
own ref, because two can be open at once and a reworked ticket runs twice.

The plan's units are the bolt. Hours on any other unit are unplanned: they are
reported, and they never join the units, the carried list or the projection.
At every event up to the end of the bolt, the projected end is the clock plus
what each unit still owes, max(0, planned - spent), until a review approves
it. A review that asks for changes leaves the unit owing.

The overrun reads the clock at BOLT_ENDED. The sum of the units' hours is
work, and two engineers do more work than the clock shows. A sponsor message
never changes the running bolt: it goes to the next bolt's elaboration, with
the hours already spent on whatever it started.
"""

import json

ELABORATION = "bolt 2 elaboration"


def run_agent(question: str, llm, tools: dict) -> str:
    plan = tools["plan"]()
    planned = plan["planned_h"]
    spent = {unit: 0.0 for unit in plan["units"]}
    unplanned, approved, opened = {}, set(), {}
    messages, waiting = [], []
    first = elapsed = None

    for event in tools["events"]():
        kind, ref, unit, h = event["kind"], event["ref"], event["unit"], event["h"]
        if kind == "SPONSOR_MESSAGE":
            body = tools["message"](ref=ref)
            text = body.get("text") if isinstance(body, dict) else None
            messages.append({"ref": ref, "text": text, "to": ELABORATION, "unit": None})
            if elapsed is None:
                waiting.append(messages[-1])
        if elapsed is not None:
            continue
        if kind in ("TICKET_STARTED", "REVIEW_REQUESTED"):
            opened[ref] = h
            if unit not in spent:
                unplanned.setdefault(unit, 0.0)
                for message in waiting:
                    message["unit"] = unit
                waiting = []
        elif kind in ("TICKET_DONE", "TICKET_PARKED", "REVIEW_DONE"):
            hours = spent if unit in spent else unplanned
            hours[unit] += h - opened.pop(ref)
            if kind == "REVIEW_DONE" and event.get("outcome") == "approved":
                approved.add(unit)
        elif kind == "BOLT_ENDED":
            elapsed = h
        owed = sum(max(0.0, planned[u] - spent[u]) for u in spent if u not in approved)
        if first is None and h + owed > plan["bolt_h"]:
            first = event["id"]

    for message in messages:
        message["hours_spent"] = unplanned.get(message["unit"], 0.0)
    return json.dumps({
        "bolt": plan["id"],
        "units": [{"unit": u, "planned_h": planned[u], "actual_h": spent[u]}
                  for u in plan["units"]],
        "unplanned": [{"unit": u, "actual_h": hours} for u, hours in unplanned.items()],
        "elapsed_h": elapsed,
        "overrun_h": max(0.0, elapsed - plan["bolt_h"]),
        "first_knowable": first,
        "carried": plan["carried"],
        "messages": messages,
    })

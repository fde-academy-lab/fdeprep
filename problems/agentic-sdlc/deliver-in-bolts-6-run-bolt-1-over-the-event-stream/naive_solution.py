"""What an unprepared learner writes in four minutes.

It keeps one start time per unit, since a unit's tickets usually run one after
another, and adds each finished run to its unit. A unit counts as done once
its review comes back, whatever the reviewer said. The bolt's length is the
sum of the hours worked, and a sponsor message goes to elaboration with the
unit of the event that follows it.

Bolt 1 as it ran passes, and so does a bolt that absorbs the installs work:
one ticket was open at a time, the hours worked add up to the clock, and a
ticket followed each message. It goes wrong three ways. Two engineers on one
unit overwrite each other's start time. A message that arrives after the bolt
ended has no event after it. A review that sends a unit back early drops what
the unit still owes from the projection, so the overrun shows hours late.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    plan = tools["plan"]()
    events = tools["events"]()
    spent = {unit: 0.0 for unit in plan["units"]}
    unplanned, done, started = {}, set(), {}
    messages, first = [], None

    for i, event in enumerate(events):
        kind, unit, h = event["kind"], event["unit"], event["h"]
        if kind in ("TICKET_STARTED", "REVIEW_REQUESTED"):
            started[unit] = h
        elif kind in ("TICKET_DONE", "TICKET_PARKED", "REVIEW_DONE"):
            hours = spent if unit in spent else unplanned
            hours[unit] = hours.get(unit, 0.0) + h - started.pop(unit)
            if kind == "REVIEW_DONE":
                done.add(unit)
        elif kind == "SPONSOR_MESSAGE":
            text = tools["message"](ref=event["ref"])["text"]
            messages.append({"ref": event["ref"], "text": text, "to": "bolt 2 elaboration",
                             "unit": events[i + 1]["unit"]})
        owed = sum(max(0.0, plan["planned_h"][u] - spent[u]) for u in spent if u not in done)
        if first is None and h + owed > plan["bolt_h"]:
            first = event["id"]

    for message in messages:
        message["hours_spent"] = unplanned.get(message["unit"], 0.0)
    worked = sum(spent.values()) + sum(unplanned.values())
    return json.dumps({
        "bolt": plan["id"],
        "units": [{"unit": u, "planned_h": plan["planned_h"][u], "actual_h": spent[u]}
                  for u in plan["units"]],
        "unplanned": [{"unit": u, "actual_h": hours} for u, hours in unplanned.items()],
        "elapsed_h": worked,
        "overrun_h": max(0.0, worked - plan["bolt_h"]),
        "first_knowable": first,
        "carried": plan["carried"],
        "messages": messages,
    })

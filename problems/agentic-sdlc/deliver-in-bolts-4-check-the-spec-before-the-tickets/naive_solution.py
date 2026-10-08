"""What an unprepared learner writes in four minutes.

It indexes the spec by id and walks the tickets. A ticket with no spec_id
waits as unspecified. Otherwise it reads the item straight out of the index,
holds the ticket as out_of_bolt when the item's unit is on the plan's
carried list, holds it as unverifiable when the item has no check, and
starts everything else.

On bolt 1's own tickets that is the right answer, because the only unit
outside the bolt with tickets is UoW-4, and UoW-4 is on the carried list. It
goes wrong twice. A ticket citing an id the spec lacks raises KeyError. A
ticket for a unit that is outside the bolt without being carried, one still
in elaboration or one Inception rejected, starts.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    items = {item["id"]: item for item in tools["spec"]()}
    tickets = tools["tickets"]()
    plan = tools["bolt_plan"]()

    ready, held = [], []
    for ticket in tickets:
        if ticket["spec_id"] is None:
            held.append({"ticket": ticket["id"], "reason": "unspecified"})
            continue
        item = items[ticket["spec_id"]]
        if item["unit"] in plan["carried"]:
            held.append({"ticket": ticket["id"], "reason": "out_of_bolt"})
        elif item["check"] is None:
            held.append({"ticket": ticket["id"], "reason": "unverifiable"})
        else:
            ready.append(ticket["id"])

    in_bolt = [item for item in items.values() if item["unit"] in plan["units"]]
    cited = {ticket["spec_id"] for ticket in tickets}
    return json.dumps({
        "ready": ready,
        "held": held,
        "uncovered": [item["id"] for item in in_bolt if item["id"] not in cited],
        "unverifiable": [item["id"] for item in in_bolt if item["check"] is None],
    })

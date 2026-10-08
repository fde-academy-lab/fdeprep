"""Reference solution for deliver-in-bolts-4-check-the-spec-before-the-tickets.

A ticket starts only when four things hold, checked in the order a person
would check them: it cites an item, the spec has that item, the item's unit
is one the bolt plan lists in `units`, and the item has a check. The first
that fails is the reason it waits. The agent's `status` is never read,
because the agent marks every ticket ready.

The bolt is the plan's `units` and nothing else. A unit can be outside the
bolt without being carried, when it is in elaboration or was never accepted,
so the carried list cannot stand in for it.

The cited id is looked up with `get`, so an id the spec lacks waits as
`unknown_spec` and covers nothing. Both read-back lists cover only the items
of the bolt's units, in spec order.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    items = {item["id"]: item for item in tools["spec"]()}
    tickets = tools["tickets"]()
    units = tools["bolt_plan"]()["units"]

    ready, held = [], []
    for ticket in tickets:
        item = items.get(ticket["spec_id"])
        if ticket["spec_id"] is None:
            reason = "unspecified"
        elif item is None:
            reason = "unknown_spec"
        elif item["unit"] not in units:
            reason = "out_of_bolt"
        elif not item["check"]:
            reason = "unverifiable"
        else:
            ready.append(ticket["id"])
            continue
        held.append({"ticket": ticket["id"], "reason": reason})

    in_bolt = [item for item in items.values() if item["unit"] in units]
    cited = {ticket["spec_id"] for ticket in tickets}
    return json.dumps({
        "ready": ready,
        "held": held,
        "uncovered": [item["id"] for item in in_bolt if item["id"] not in cited],
        "unverifiable": [item["id"] for item in in_bolt if not item["check"]],
    })

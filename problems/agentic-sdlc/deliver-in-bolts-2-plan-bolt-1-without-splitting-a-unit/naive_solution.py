"""What an unprepared learner writes in four minutes.

It plans in dependency order, counts each review inside the bolt and carries
whole whatever does not fit, so every public case passes. It reads a missing
estimate the way the construction agent did, as zero hours. Slot booking then
costs one review hour, goes into bolt 1, and makes the units waiting on it
look ready. Nothing ever reaches elaboration.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    units = tools["units"]()
    bolt = tools["bolt"]()
    waiting = list(units)

    planned, carried, hours = [], [], 0
    while True:
        ready = [unit for unit in waiting if all(dep in planned for dep in unit["depends_on"])]
        if not ready:
            break
        unit = ready[0]
        waiting.remove(unit)
        need = (unit["estimate_h"] or 0) + bolt["review_h"]
        if hours + need <= bolt["hours"]:
            planned.append(unit["id"])
            hours += need
        else:
            carried.append(unit["id"])
    carried += [unit["id"] for unit in waiting]

    return json.dumps({"id": bolt["id"], "units": planned, "hours": hours,
                       "review_hours": bolt["review_h"] * len(planned),
                       "spare": bolt["hours"] - hours,
                       "carried": carried, "elaboration": []})

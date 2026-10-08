"""Reference solution for deliver-in-bolts-2-plan-bolt-1-without-splitting-a-unit.

A null estimate means nobody knows how long the unit takes, so the unit goes to
elaboration and never into the bolt as zero hours. A unit that waits on it is
never ready either, because ready means every dependency is already in this
bolt.

Each unit needs its estimate plus its review inside the bolt, since a unit is
finished when its review passes. The planner takes the first ready unit in id
order, plans it whole or carries it whole, and looks again from the first
unit, because planning one unit can make a lower id ready. Whatever is still
waiting when nothing is ready is carried after the units the planner tried.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    units = tools["units"]()
    bolt = tools["bolt"]()
    elaboration = [unit["id"] for unit in units if unit["estimate_h"] is None]
    waiting = [unit for unit in units if unit["estimate_h"] is not None]

    planned, carried, hours = [], [], 0
    while True:
        ready = [unit for unit in waiting if all(dep in planned for dep in unit["depends_on"])]
        if not ready:
            break
        unit = ready[0]
        waiting.remove(unit)
        need = unit["estimate_h"] + bolt["review_h"]
        if hours + need <= bolt["hours"]:
            planned.append(unit["id"])
            hours += need
        else:
            carried.append(unit["id"])
    carried += [unit["id"] for unit in waiting]

    return json.dumps({"id": bolt["id"], "units": planned, "hours": hours,
                       "review_hours": bolt["review_h"] * len(planned),
                       "spare": bolt["hours"] - hours,
                       "carried": carried, "elaboration": elaboration})

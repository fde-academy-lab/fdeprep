"""What an unprepared learner writes in four minutes.

It keeps a unit whole when it fits and splits a unit bigger than a bolt task
by task, which is most of the job. It never asks whether one task is bigger
than a bolt. A 22-hour task finds no room in the current bolt, so it opens the
next bolt and goes in alone, and that bolt holds 22 hours against a cap of 16.
Nothing ever reaches too_large.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    plan = tools["plan"]()
    cap = plan["bolt_hours"]
    bolts = [{"n": 1, "hours": 0, "tasks": []}]
    units_split = []

    for unit in plan["units"]:
        hours = sum(task["hours"] for task in unit["tasks"])
        if hours <= cap:
            if bolts[-1]["hours"] + hours > cap:
                bolts.append({"n": len(bolts) + 1, "hours": 0, "tasks": []})
            for task in unit["tasks"]:
                bolts[-1]["hours"] += task["hours"]
                bolts[-1]["tasks"].append(task["id"])
        else:
            units_split.append(unit["id"])
            for task in unit["tasks"]:
                if bolts[-1]["hours"] + task["hours"] > cap:
                    bolts.append({"n": len(bolts) + 1, "hours": 0, "tasks": []})
                bolts[-1]["hours"] += task["hours"]
                bolts[-1]["tasks"].append(task["id"])

    return json.dumps({"bolts": [bolt for bolt in bolts if bolt["tasks"]],
                       "too_large": [], "units_split": units_split})

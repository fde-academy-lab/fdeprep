"""Reference solution for pack-units-of-work-into-bolts.

A bolt has a cap so that a plan can say when work finishes. A unit of work
goes into the current bolt whole when it fits, starts the next bolt when only
an empty one can hold it, and is split task by task only when no bolt can
hold it. An earlier bolt takes no more work once the next one has started.

A task bigger than the cap fits no bolt, empty or not, so it is compared with
the cap before the packer looks for a bolt. It goes back to the delivery lead
in too_large, because giving it a bolt of its own breaks the cap there and
trimming its estimate hides the overrun until the bolt runs late.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    plan = tools["plan"]()
    cap = plan["bolt_hours"]
    bolts = [{"n": 1, "hours": 0, "tasks": []}]
    too_large = []
    units_split = []

    for unit in plan["units"]:
        hours = sum(task["hours"] for task in unit["tasks"])
        if hours <= cap:
            if bolts[-1]["hours"] + hours > cap:
                open_bolt(bolts)
            for task in unit["tasks"]:
                add(bolts[-1], task)
            continue

        units_split.append(unit["id"])
        for task in unit["tasks"]:
            if task["hours"] > cap:
                too_large.append(task["id"])
                continue
            if bolts[-1]["hours"] + task["hours"] > cap:
                open_bolt(bolts)
            add(bolts[-1], task)

    return json.dumps({"bolts": [bolt for bolt in bolts if bolt["tasks"]],
                       "too_large": too_large, "units_split": units_split})


def open_bolt(bolts: list) -> None:
    """Start the next bolt. Earlier bolts take no more tasks."""
    bolts.append({"n": len(bolts) + 1, "hours": 0, "tasks": []})


def add(bolt: dict, task: dict) -> None:
    """Put one task in a bolt."""
    bolt["hours"] += task["hours"]
    bolt["tasks"].append(task["id"])

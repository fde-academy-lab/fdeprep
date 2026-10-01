"""Reference solution for promote-a-pilot-only-when-every-gate-holds.

A gate is a promise the sponsor agreed to, and it holds only on evidence. A
measurement nobody recorded is a gate that does not hold, and so is an
accuracy read from fewer graded tasks than the table asks for.

Every gate of a stage is checked and every one that does not hold is named,
so the committee sees the whole list of work instead of its first item.

A pilot moves one stage per review. A POC's numbers come from a setting with
no real users in it, so whatever they say about production, the stage above a
POC is an MVP.
"""

import json

STAGES = ("poc", "mvp", "production")
GATES = ("accuracy", "cost_per_task", "escalation_rate", "sign_off")


def _number(value):
    """A measurement, or None when nobody recorded one."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _ratio(top, bottom):
    top, bottom = _number(top), _number(bottom)
    if top is None or not bottom:
        return None
    return top / bottom


def _holds(gate, results, limits, stage):
    if gate == "accuracy":
        graded = _number(results.get("graded"))
        accuracy = _ratio(results.get("correct"), graded)
        return (graded is not None and graded >= limits["min_graded"]
                and accuracy is not None and accuracy >= limits["accuracy"])
    if gate == "cost_per_task":
        cost = _ratio(results.get("spend_inr"), results.get("tasks"))
        return cost is not None and cost <= limits["cost_per_task_inr"]
    if gate == "escalation_rate":
        rate = _ratio(results.get("escalated"), results.get("tasks"))
        return rate is not None and rate <= limits["escalation_rate"]
    return stage in (results.get("signed_off") or [])


def _missed(stage, results, table):
    """Every gate of the stage that does not hold, in the contract's order."""
    limits = table[stage]
    return [gate for gate in GATES if not _holds(gate, results, limits, stage)]


def _above(stage):
    return STAGES[STAGES.index(stage) + 1]


def run_agent(question: str, llm, tools: dict) -> str:
    results = tools["pilot_results"]() or {}
    table = tools["gate_table"]() or {}

    stage = results.get("stage") if results.get("stage") in STAGES else "poc"
    if stage != "production" and not _missed(_above(stage), results, table):
        stage = _above(stage)

    missed = [] if stage == "production" else _missed(_above(stage), results, table)
    return json.dumps({"stage": stage, "missed": missed})

"""What an unprepared learner writes in four minutes.

It works out the three measurements, tries production first and MVP second,
and returns the first stage whose gates all hold. That is the spreadsheet's
logic. Accuracy is read from however many tasks were graded, a spend nobody
recorded raises a TypeError, and a POC whose numbers clear the production
gates goes straight to production.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    results = tools["pilot_results"]()
    table = tools["gate_table"]()

    accuracy = results["correct"] / results["graded"]
    cost = results["spend_inr"] / results["tasks"]
    escalation = results["escalated"] / results["tasks"]

    def misses(stage):
        gate = table[stage]
        out = []
        if accuracy < gate["accuracy"]:
            out.append("accuracy")
        if cost > gate["cost_per_task_inr"]:
            out.append("cost_per_task")
        if escalation > gate["escalation_rate"]:
            out.append("escalation_rate")
        if stage not in results["signed_off"]:
            out.append("sign_off")
        return out

    if not misses("production"):
        return json.dumps({"stage": "production", "missed": []})
    if not misses("mvp"):
        return json.dumps({"stage": "mvp", "missed": misses("production")})
    return json.dumps({"stage": results["stage"], "missed": misses("mvp")})

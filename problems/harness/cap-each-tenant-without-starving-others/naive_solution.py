"""What an unprepared learner writes in four minutes.

It reads the plans and checks all three limits, so the public cases pass. The
counters go up as each run arrives, before anything decides it, so a flood of
refused runs fills the account's minute for every other client. A client's run
count never resets, so a client refused in its first minute stays refused for
the rest of the batch. And the budget is checked against what is already
spent, so the run that crosses it is sent with its whole ceiling.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    runs = tools["batch"]()["runs"]
    plans = tools["plans"]()
    limits = plans["tenants"]

    spent = {}
    sent_by_tenant = {}
    sent_by_window = {}
    answers = {}
    for run in runs:
        tenant = run["tenant"]
        window = run["at_s"] // 60
        sent_by_window[window] = sent_by_window.get(window, 0) + 1
        sent_by_tenant[tenant] = sent_by_tenant.get(tenant, 0) + 1
        plan = limits[tenant]

        if sent_by_window[window] > plans["account_rpm"]:
            answers[run["id"]] = {"status": "refused", "reason": "account_rate",
                                  "retry_at_s": (window + 1) * 60}
        elif sent_by_tenant[tenant] > plan["rpm"]:
            answers[run["id"]] = {"status": "refused", "reason": "tenant_rate",
                                  "retry_at_s": (window + 1) * 60}
        elif spent.get(tenant, 0) >= plan["tokens"]:
            answers[run["id"]] = {"status": "refused", "reason": "token_budget",
                                  "retry_at_s": None}
        else:
            reply = tools["complete"](run=run["id"], prompt=run["prompt"],
                                      max_tokens=run["max_tokens"])
            spent[tenant] = spent.get(tenant, 0) + reply["tokens"]
            answers[run["id"]] = {"status": "done", "tokens": reply["tokens"]}

    return json.dumps(answers)

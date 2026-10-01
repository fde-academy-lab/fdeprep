"""What an unprepared learner writes in four minutes.

It does what the dashboard did. Latency is the time spent in calls, added up,
which is right while calls run one after another and counts the same seconds
twice once the lookups run at the same time. Cost is the model tokens at
their rates, with a missing rate read as zero, so a fallback model nobody
priced looks free. Paid tool calls are left out of the cost altogether.
"""

import json
import math


def nearest_rank(values, p):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(1, math.ceil(p / 100 * len(ordered))) - 1]


def run_agent(question, llm, tools):
    log = tools["runs"](day=question)
    card = tools["rate_card"]()
    models = card["models"]
    budget = card["budget"]

    rows, over_budget = [], []
    for run in log["runs"]:
        cost = 0.0
        for event in run["events"]:
            if event["type"] == "model":
                rates = models.get(event["model"], {})
                cost += event["input_tokens"] * rates.get("input_per_million", 0) / 1_000_000
                cost += event["output_tokens"] * rates.get("output_per_million", 0) / 1_000_000
        latency = sum(e["end_ms"] - e["start_ms"] for e in run["events"])
        rows.append({"run": run["run"], "cost_usd": round(cost, 6), "latency_ms": latency})
        if cost > budget["cost_usd"] or latency > budget["latency_ms"]:
            over_budget.append(run["run"])

    latencies = [r["latency_ms"] for r in rows]
    costs = [r["cost_usd"] for r in rows]
    return json.dumps({
        "runs": rows,
        "latency_ms": {"p50": nearest_rank(latencies, 50), "p95": nearest_rank(latencies, 95)},
        "cost_usd": {"p50": nearest_rank(costs, 50), "p95": nearest_rank(costs, 95)},
        "over_budget": over_budget,
        "unpriced": [],
    })

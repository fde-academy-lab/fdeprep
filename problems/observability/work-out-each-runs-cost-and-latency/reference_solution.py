"""Reference solution for work-out-each-runs-cost-and-latency.

A run's latency is how long the customer waited: from its earliest start to
its latest end. The assistant runs its lookups at the same time, so adding
the durations up counts the same seconds two or three times. The trace store
lists events in the order they ended, so the first event in the list is not
always the first to start either, and only the earliest start will do.

A run's cost is every billed line in it: each model call's input and output
tokens at that model's own rates per million, and each paid tool call's fee.
A model missing from the rate card makes the run's cost unknown. None is the
honest figure, because a zero makes the fallback runs look free, drags the
cost percentiles down and keeps those runs out of the budget check, all
without a word.

Percentiles are by nearest rank, over every run for latency and over the runs
with a known cost for cost. The unknown ones are listed, not averaged in.
"""

import json
import math

MILLION = 1_000_000


def nearest_rank(values: list, p: int):
    """The p-th percentile by nearest rank, or None when there are no values."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(1, math.ceil(p / 100 * len(ordered))) - 1]


def run_cost(events: list, models: dict, fees: dict):
    """Every billed line in the run, or None when a model has no rate."""
    cost = 0.0
    for event in events:
        if event.get("type") == "model":
            rates = models.get(event.get("model"))
            if rates is None:
                return None
            cost += event.get("input_tokens", 0) * rates["input_per_million"] / MILLION
            cost += event.get("output_tokens", 0) * rates["output_per_million"] / MILLION
        elif event.get("type") == "tool":
            cost += fees.get(event.get("tool"), 0)
    return round(cost, 6)


def run_latency(events: list):
    """How long the customer waited: earliest start to latest end."""
    if not events:
        return None
    return max(e["end_ms"] for e in events) - min(e["start_ms"] for e in events)


def run_agent(question: str, llm, tools: dict) -> str:
    log = tools["runs"](day=question) or {}
    card = tools["rate_card"]() or {}
    models = card.get("models") or {}
    fees = card.get("tools") or {}
    budget = card.get("budget") or {}
    cost_cap = budget.get("cost_usd", float("inf"))
    time_cap = budget.get("latency_ms", float("inf"))

    rows, over_budget, unpriced = [], [], []
    for run in log.get("runs") or []:
        events = run.get("events") or []
        cost = run_cost(events, models, fees)
        latency = run_latency(events)
        rows.append({"run": run.get("run"), "cost_usd": cost, "latency_ms": latency})
        if cost is None:
            unpriced.append(run.get("run"))
        too_dear = cost is not None and cost > cost_cap
        too_slow = latency is not None and latency > time_cap
        if too_dear or too_slow:
            over_budget.append(run.get("run"))

    latencies = [r["latency_ms"] for r in rows if r["latency_ms"] is not None]
    costs = [r["cost_usd"] for r in rows if r["cost_usd"] is not None]
    return json.dumps({
        "runs": rows,
        "latency_ms": {"p50": nearest_rank(latencies, 50), "p95": nearest_rank(latencies, 95)},
        "cost_usd": {"p50": nearest_rank(costs, 50), "p95": nearest_rank(costs, 95)},
        "over_budget": over_budget,
        "unpriced": unpriced,
    })

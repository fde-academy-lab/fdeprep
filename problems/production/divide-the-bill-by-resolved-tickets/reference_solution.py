"""Reference solution for divide-the-bill-by-resolved-tickets.

Cost per resolution has one rule. The numerator is everything that was paid
for, whatever happened to it, and the denominator is only what the client pays
for. Escalations and timeouts belong in the first and never in the second.

A ticket counts once, whatever number of its attempts resolved. An
orchestrator that retries after a client-side timeout can resolve the same
ticket twice, and that is one resolution that cost two attempts.

A week with no resolution has no price. The figure is None, never an
exception and never zero, because zero would tell the commercial lead the
agent was free.
"""

import json
import re

_WEEK = re.compile(r"week=(\d+)")


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(f"Question: {question}\n")
    week = _WEEK.search(reply)
    log = tools["run_log"](week=week.group(1) if week else "") or {}
    attempts = log.get("attempts") or []

    total_spend = sum(float(a.get("cost_usd") or 0) for a in attempts)
    resolved = {a.get("ticket") for a in attempts if a.get("outcome") == "resolved"}
    per_resolution = total_spend / len(resolved) if resolved else None

    return json.dumps({
        "total_spend_usd": round(total_spend, 4),
        "resolved_tickets": len(resolved),
        "cost_per_resolved_ticket_usd":
            None if per_resolution is None else round(per_resolution, 4),
    })

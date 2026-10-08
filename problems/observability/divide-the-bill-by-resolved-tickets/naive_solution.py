"""What an unprepared learner writes in four minutes.

It adds up the week's spend and divides by every ticket in the log, which is
the dashboard's number: what a ticket the agent touched costs. Escalated
tickets sit in the denominator, so every failure makes a success look cheaper,
and a week with nothing resolved still gets a price.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(f"Question: {question}\n")
    week = re.search(r"week=(\d+)", reply)
    attempts = tools["run_log"](week=week.group(1) if week else "")["attempts"]

    spend = sum(a["cost_usd"] for a in attempts)
    tickets = {a["ticket"] for a in attempts}

    return json.dumps({
        "total_spend_usd": round(spend, 4),
        "resolved_tickets": len(tickets),
        "cost_per_resolved_ticket_usd": round(spend / len(tickets), 4),
    })

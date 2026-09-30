"""What an unprepared learner writes in four minutes.

It does what the team's check did: add up the line amounts in floats and
compare them with the subtotal. When they match it pays the total as read.
The total is never compared with anything, no row is multiplied out, and float
addition misses a subtotal of whole pence often enough to hold correct
invoices at random.
"""

import json


def money(text):
    return float(str(text).replace("£", "").replace(",", ""))


def run_agent(question: str, llm, tools: dict) -> str:
    page = tools["page_text"](invoice=question)["text"]
    table = json.loads(llm(f"Read the invoice table on this page as JSON.\n\n{page}\n"))

    lines = sum(money(row["amount"]) for row in table["rows"])
    if lines == money(table["subtotal"]):
        total_pence = round(money(table["total"]) * 100)
        tools["approve_payment"](invoice=question, amount_pence=total_pence)
        return json.dumps({"status": "verified", "total_pence": total_pence, "issues": []})

    issues = [{"check": "subtotal", "line": None}]
    tools["hold_for_review"](invoice=question, issues=issues)
    return json.dumps({"status": "flagged", "total_pence": None, "issues": issues})

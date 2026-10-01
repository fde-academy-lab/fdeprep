"""What an unprepared learner writes in four minutes.

It hands the ticket to whatever specialist triage names, with whatever triage
read in the text. An order the app attached to the ticket never reaches the
specialist, a ticket with no order at all goes to billing or delivery anyway,
and a specialist nobody runs raises a KeyError.
"""

import json


def triage_prompt(ticket: dict) -> str:
    text = ticket.get("text", "")
    return (
        "You triage support tickets for an electronics retailer.\n"
        'Reply with JSON only: {"specialist": "billing", "delivery" or "account", '
        '"order": the order number the text names or null, "summary": one sentence}.\n'
        f"<ticket>\n{text}\n</ticket>\n"
    )


def run_agent(question: str, llm, tools: dict) -> str:
    ticket = json.loads(question)
    triage = json.loads(llm(triage_prompt(ticket)))
    handoff = tools[triage["specialist"]](
        ticket=ticket["ticket"],
        customer=ticket["customer"],
        order=triage.get("order"),
        summary=triage["summary"],
    )
    return handoff["reply"]

"""Reference solution for extract-a-ticket-without-guessing.

The prompt asks the model for null when the email does not state a field, and
the model still guesses sometimes. The check that matters runs after the reply:
a value goes on the ticket only when the email contains it.

The ticket's keys come from FIELDS, never from the reply. Every field starts at
None, so a field the model left out is null on the ticket and a field the model
added has nowhere to go.
"""

import json

FIELDS = ("order_id", "email", "phone")


def build_prompt(email_text: str) -> str:
    return (
        "Read the customer email below. Reply with a JSON object with the keys "
        "order_id, email and phone. Use null for anything the email does not "
        "state.\n\n"
        f"Email:\n{email_text}\n"
    )


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(build_prompt(question))

    extracted = json.loads(reply)
    if not isinstance(extracted, dict):
        extracted = {}

    ticket = {name: None for name in FIELDS}
    for name in FIELDS:
        value = extracted.get(name)
        if stated_in(value, question):
            ticket[name] = value.strip()

    return json.dumps(ticket)


def stated_in(value, email_text: str) -> bool:
    """True when value is a non-empty string that the email contains."""
    if not isinstance(value, str) or not value.strip():
        return False
    return value.strip().lower() in email_text.lower()

"""What an unprepared learner writes in four minutes.

It sends the customer's message as it arrived and scrubs the draft on its way
out, which is the fix the team already tried. The prompt still carries every
email address, phone number and card number, so the gateway refuses it, and
where a draft does come back, the customer's own details have been scrubbed
out of it.
"""

import json
import re

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?:\+44\s?7\d{3}|\b07\d{3})\s?\d{3}\s?\d{3}\b")
CARD = re.compile(r"\b(?:\d{4}[ -]){3}\d{4}\b")


def run_agent(question: str, llm, tools: dict) -> str:
    ticket = tools["read_ticket"]()

    reply = llm(f"{question}\n\nCustomer message:\n{ticket['body']}\n")
    draft = reply.split("Final Answer:", 1)[-1].strip()

    for pattern in (CARD, EMAIL, PHONE):
        draft = pattern.sub("[redacted]", draft)
    return draft

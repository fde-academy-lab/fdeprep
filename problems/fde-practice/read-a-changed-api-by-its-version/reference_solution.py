"""Reference solution for read-a-changed-api-by-its-version.

The version is read before the value, because it is the only thing in the
bill that says what the value means. A field name says where a number is.
Versions 2 and 3 use the same name for a number in different units, so any
parser that goes by which field is present reads pence as pounds.

The versions live in one table, from version to the field that holds the
amount and how many of its units make a pound. Supporting version 4 is one
new row, and an unknown version is a lookup miss rather than a branch nobody
wrote.

A bill that cannot be read is handed to a person instead of the model. The
model cannot tell a zero that was read from a zero that was invented, so a
default of zero is how a renamed field becomes a customer told they owe
nothing.
"""

import json
import re

# api_version -> (the field holding the amount, how many of its units make a pound)
LAYOUTS = {
    "1": ("amount", 1),
    "2": ("amount_due", 1),
    "3": ("amount_due", 100),
}


def pounds_due(bill: dict):
    """The amount in pounds, or a Handoff sentence saying why it was not read."""
    version = str(bill.get("api_version"))
    if version not in LAYOUTS:
        return None, (f"Handoff: billing API version {version} is not one this "
                      "integration can read, so the amount due was not read.")

    field, per_pound = LAYOUTS[version]
    if field not in bill:
        return None, (f"Handoff: billing API version {version} sent no {field} field, "
                      "so the amount due was not read.")

    raw = bill[field]
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None, (f"Handoff: billing API version {version} sent {field} as "
                      f"{json.dumps(raw)}, so the amount due was not read.")
    return raw / per_pound, None


def run_agent(question: str, llm, tools: dict) -> str:
    account = re.search(r"ACC-\d+", question).group(0)
    bill = tools["billing"](account=account) or {}

    pounds, handoff = pounds_due(bill)
    if handoff:
        return handoff

    prompt = (
        f"Customer message: {question}\n"
        f"Amount due: £{pounds:.2f}\n"
        f"Due date: {bill.get('due')}\n"
        "Answer the customer in one sentence, using only the figures above."
    )
    return llm(prompt)

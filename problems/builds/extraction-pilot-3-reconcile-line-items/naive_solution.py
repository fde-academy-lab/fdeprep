"""What an unprepared learner writes in four minutes.

It adds the line items up and compares the sum with the total, which is the
right idea done three wrong ways. The lines are whatever the model returned,
so a line the model wrote to make the total balance counts as evidence that
it balances. The sum is taken in floats, so a claim that adds up to the penny
can miss by a hair and go to a person. And the invoice is indexed before
anyone checks that it arrived.
"""

import json
import re

FIELDS = ("policy_number", "claimant", "incident_date", "amount_claimed")
POLICY_NUMBER = re.compile(r"^[A-Z]{2}-\d{6}$")
AMOUNT = re.compile(r"^£\d[\d,]*(?:\.\d{2})?$")

NOT_IN_INVOICE = "line_items: {amount} is not in the invoice"
NO_ITEMS = "line_items: missing"
DOES_NOT_ADD_UP = "amount_claimed: does not match the line items"

EXTRACT = (
    "Read the claim letter and the invoice below. Reply with one JSON object and "
    "nothing else, with exactly these keys: policy_number, claimant, "
    "incident_date, amount_claimed, line_items.\n"
    "Copy each value exactly as it is written. amount_claimed is the total the "
    "letter claims. line_items is a list with one object for each line of the "
    "invoice, each with a description and an amount. When a value is not "
    "stated, use null.\n\n"
    "<letter>\n{letter}\n</letter>\n<invoice>\n{invoice}\n</invoice>\n"
)

REPAIR = (
    "{extract}\n"
    "Your previous reply was:\n{reply}\n\n"
    "It was rejected for these reasons:\n{errors}\n\n"
    "Reply with the corrected JSON object. A value that is not written in the "
    "letter or the invoice stays null.\n"
)


def run_agent(question: str, llm, tools: dict) -> str:
    invoice_text = tools["invoice"]()["text"]

    prompt = EXTRACT.format(letter=question, invoice=invoice_text)
    reply = llm(prompt)
    record, errors = _check(reply, question, invoice_text)

    if errors:
        repair = REPAIR.format(extract=prompt, reply=reply, errors="\n".join(errors))
        record, errors = _check(llm(repair), question, invoice_text)

    if errors:
        tools["human_queue"](record=record, errors=errors)
        status = "queued"
    else:
        tools["submit"](record=record)
        status = "submitted"
    return json.dumps({"status": status, "record": record, "errors": errors})


def _check(reply: str, letter: str, invoice_text: str):
    extracted = _parse(reply)
    record = _ground(extracted, letter)
    errors = _validate(record)
    record["line_items"] = extracted.get("line_items") or []
    return record, errors + _reconcile(record)


def _reconcile(record: dict) -> list:
    items = record["line_items"]
    if not items:
        return [NO_ITEMS]
    if record["amount_claimed"] is None:
        return [DOES_NOT_ADD_UP]
    total = sum(float(item["amount"].replace("£", "").replace(",", "")) for item in items)
    claimed = float(record["amount_claimed"].replace("£", "").replace(",", ""))
    return [] if total == claimed else [DOES_NOT_ADD_UP]


def _parse(reply: str) -> dict:
    try:
        parsed = json.loads(reply)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _ground(extracted: dict, letter: str) -> dict:
    source = _normalise(letter)
    record = {}
    for field in FIELDS:
        value = extracted.get(field)
        if isinstance(value, str) and value.strip() and _normalise(value) in source:
            record[field] = value.strip()
        else:
            record[field] = None
    return record


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def _validate(record: dict) -> list:
    errors = [f"{field}: missing" for field in FIELDS if record.get(field) is None]
    policy = record.get("policy_number")
    if policy is not None and not POLICY_NUMBER.match(policy):
        errors.append("policy_number: not a policy number")
    amount = record.get("amount_claimed")
    if amount is not None and not AMOUNT.match(amount):
        errors.append("amount_claimed: not an amount")
    return errors

"""What an unprepared learner writes in four minutes.

It is the first draft of this stage: read the invoice, keep each line item
whose amount the invoice text contains, add the kept amounts in whole pence and
compare the sum with the claim. The arithmetic is right and the line check is
too loose. The invoice text holds the total, the VAT and every item's price, so
the Total line copied as an item counts, the VAT line the repair adds counts,
and so does a planted line that borrows another item's price. Each of those
makes the books balance, and the claim is paid. It never reads the invoice's
number either, so another customer's invoice that adds up is paid as well.
"""

import json
import re

FIELDS = ("policy_number", "claimant", "incident_date", "amount_claimed")
POLICY_NUMBER = re.compile(r"^[A-Z]{2}-\d{6}$")
AMOUNT = re.compile(r"^£\d[\d,]*(?:\.\d{2})?$")
MONEY = re.compile(r"^£?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?$")

NOT_A_GOODS_LINE = "line_items: {amount} matches no goods line on the invoice"
NO_ITEMS = "line_items: missing"
DOES_NOT_ADD_UP = "amount_claimed: does not match the line items"

EXTRACT = (
    "Read the claim letter and the invoice below. Reply with one JSON object and "
    "nothing else, with exactly these keys: policy_number, claimant, "
    "incident_date, amount_claimed, line_items.\n"
    "Copy each value exactly as it is written. amount_claimed is the total the "
    "letter claims. line_items is a list with one object for each line of goods "
    "on the invoice, each with a description and an amount. When a value is not "
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
    invoice = tools["invoice"]() or {}
    invoice_text = invoice.get("text") or ""

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
    items, item_errors = _ground_items(extracted.get("line_items"), invoice_text)
    record["line_items"] = items
    return record, errors + item_errors + _reconcile(record)


def _ground_items(items, invoice_text: str):
    source = _normalise(invoice_text)
    kept, errors = [], []
    for item in items or []:
        amount = item.get("amount") or ""
        if source and _normalise(amount) in source:
            kept.append({"description": item.get("description"), "amount": amount})
        else:
            errors.append(NOT_A_GOODS_LINE.format(amount=amount))
    return kept, errors


def _reconcile(record: dict) -> list:
    items = record["line_items"]
    if not items:
        return [NO_ITEMS]
    claimed = _pence(record["amount_claimed"])
    if claimed is None or sum(_pence(item["amount"]) or 0 for item in items) != claimed:
        return [DOES_NOT_ADD_UP]
    return []


def _pence(amount):
    found = MONEY.match((amount or "").strip())
    if found is None:
        return None
    return int(found.group(1).replace(",", "")) * 100 + int(found.group(2) or 0)


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

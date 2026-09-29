"""Reference solution for extraction-pilot-3-reconcile-line-items.

A claim with an invoice carries two numbers that should agree: the total the
letter claims, and the sum of the invoice lines. Neither is authoritative on
its own. The letter can be inflated, a trader can print a line wrong, and the
model can merge two rows or balance the books with a line it wrote itself.
Reconciling them turns a silent disagreement into an error line a person can
act on.

Every line has to come from the invoice before it counts, which is stage 1's
letter check applied to the attachment. Without it the model can make any
total add up, and it did: given a claim of £1,540.00 and an invoice for
£1,465.00, it added a delivery line for the difference.

Money is added in whole pence. Binary floating point holds almost no pence
value exactly, and £229.99 + £599.99 + £1,249.99 comes out a hair above
£2,079.97 in floats, which would send a correct claim to a person for nothing.

The new error lines join the intake errors, so stage 2's one repair and its
routing handle them without a line of new control flow.
"""

import json
import re

FIELDS = ("policy_number", "claimant", "incident_date", "amount_claimed")
POLICY_NUMBER = re.compile(r"^[A-Z]{2}-\d{6}$")
AMOUNT = re.compile(r"^£\d[\d,]*(?:\.\d{2})?$")
MONEY = re.compile(r"^£?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?$")

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
    invoice = tools["invoice"]() or {}
    invoice_text = invoice.get("text") if isinstance(invoice, dict) else None
    if not isinstance(invoice_text, str):
        invoice_text = ""

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
    """Everything one reply has to pass. Returns (record, error lines)."""
    extracted = _parse(reply)
    record = _ground(extracted, letter)
    errors = _validate(record)

    items, item_errors = _ground_items(extracted.get("line_items"), invoice_text)
    record["line_items"] = items
    return record, errors + item_errors + _reconcile(record)


def _ground_items(items, invoice_text: str):
    """Keep the items whose amount the invoice shows. Returns (kept, error lines)."""
    source = _normalise(invoice_text)
    kept, errors = [], []
    for item in items if isinstance(items, list) else []:
        amount = item.get("amount") if isinstance(item, dict) else None
        if not isinstance(amount, str) or not amount.strip():
            continue
        if source and _normalise(amount) in source:
            kept.append({"description": item.get("description"), "amount": amount.strip()})
        else:
            errors.append(NOT_IN_INVOICE.format(amount=amount.strip()))
    return kept, errors


def _reconcile(record: dict) -> list:
    """Error lines for line items that are missing or do not add up."""
    items = record.get("line_items") or []
    if not items:
        return [NO_ITEMS]
    claimed = _pence(record.get("amount_claimed"))
    lines = [_pence(item["amount"]) for item in items]
    if claimed is None or None in lines or sum(lines) != claimed:
        return [DOES_NOT_ADD_UP]
    return []


def _pence(amount):
    """£1,249.99 is 124999, £89 is 8900, and anything else is None."""
    if not isinstance(amount, str):
        return None
    found = MONEY.match(amount.strip())
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
    """Stage 1: a field survives only when the letter contains it."""
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
    """Stage 2: the claims system's intake rules, one error line per failed rule."""
    errors = [f"{field}: missing" for field in FIELDS if record.get(field) is None]
    policy = record.get("policy_number")
    if policy is not None and not POLICY_NUMBER.match(policy):
        errors.append("policy_number: not a policy number")
    amount = record.get("amount_claimed")
    if amount is not None and not AMOUNT.match(amount):
        errors.append("amount_claimed: not an amount")
    return errors

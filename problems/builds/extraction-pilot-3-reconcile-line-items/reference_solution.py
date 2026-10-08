"""Reference solution for extraction-pilot-3-reconcile-line-items.

An itemised claim carries two numbers that should agree: the total the letter
claims, and the sum of the goods on the invoice. Neither is authoritative on
its own, so a disagreement goes to an adjuster with its reason.

Most of the work is deciding what counts as a line. An invoice prints more
amounts than it has goods: its own total, and often a subtotal and VAT. A check
that finds an amount anywhere in the text lets the model copy the Total line as
the only item, lets the one repair balance a VAT invoice by adding the VAT, and
lets an amount borrowed from another item's line through on a description the
invoice never shows. So an item counts only when one goods line, above the
Total line and not a subtotal or VAT line, holds its description and its amount
together. The repair's reply goes through the same check as the first reply,
which is what stops it balancing the books.

A claim that equals the grand total while its goods add up to less is a VAT or
charges question. Whether VAT is paid depends on whether the policyholder can
reclaim it, which no letter says, so an adjuster decides.

The invoice has to be the one the letter names before any line on it means
anything: another customer's invoice for the same goods adds up perfectly.

Money is added in whole pence, because binary floating point holds almost no
pence value exactly.
"""

import json
import re

FIELDS = ("policy_number", "claimant", "incident_date", "amount_claimed")
POLICY_NUMBER = re.compile(r"^[A-Z]{2}-\d{6}$")
AMOUNT = re.compile(r"^£\d[\d,]*(?:\.\d{2})?$")
MONEY = re.compile(r"^£?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?$")
INVOICE_NUMBER = re.compile(r"\binvoice no\.\s*(\d+)", re.IGNORECASE)

WRONG_INVOICE = "invoice: the letter names No. {letter}, the invoice is No. {invoice}"
NOT_A_GOODS_LINE = "line_items: {amount} matches no goods line on the invoice"
NO_ITEMS = "line_items: missing"
INCLUDES_CHARGES = "amount_claimed: includes VAT or charges that are not line items"
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
    invoice = tools["invoice"]()
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
    errors = _validate(record) + _same_invoice(letter, invoice_text)

    items, item_errors = _ground_items(extracted.get("line_items"), invoice_text)
    record["line_items"] = items
    return record, errors + item_errors + _reconcile(record, invoice_text)


def _same_invoice(letter: str, invoice_text: str) -> list:
    """An invoice whose number is not the letter's belongs to another claim."""
    named = INVOICE_NUMBER.search(letter)
    shown = INVOICE_NUMBER.search(invoice_text)
    if named and shown and named.group(1) != shown.group(1):
        return [WRONG_INVOICE.format(letter=named.group(1), invoice=shown.group(1))]
    return []


def _ground_items(items, invoice_text: str):
    """Keep the items one goods line holds. Returns (kept, error lines)."""
    goods, _ = _read_invoice(invoice_text)
    kept, errors = [], []
    for item in items if isinstance(items, list) else []:
        item = item if isinstance(item, dict) else {}
        description, amount = item.get("description"), item.get("amount")
        if _on_one_goods_line(description, amount, goods):
            kept.append({"description": description.strip(), "amount": amount.strip()})
        else:
            errors.append(NOT_A_GOODS_LINE.format(amount=amount))
    return kept, errors


def _on_one_goods_line(description, amount, goods: list) -> bool:
    if not (isinstance(description, str) and isinstance(amount, str)):
        return False
    description, amount = _normalise(description), _normalise(amount)
    return bool(description and amount) and any(
        description in line and amount in line for line in goods
    )


def _reconcile(record: dict, invoice_text: str) -> list:
    """Error lines for line items that are missing or do not add up."""
    items = record["line_items"]
    if not items:
        return [NO_ITEMS]
    claimed = _pence(record.get("amount_claimed"))
    lines = [_pence(item["amount"]) for item in items]
    if claimed is None or None in lines:
        return [DOES_NOT_ADD_UP]
    if sum(lines) == claimed:
        return []
    _, total = _read_invoice(invoice_text)
    if sum(lines) < claimed and claimed == total:
        return [INCLUDES_CHARGES]
    return [DOES_NOT_ADD_UP]


def _read_invoice(invoice_text: str):
    """(goods lines, the Total line's amount in pence), the lines normalised.

    Goods lines sit above the Total line, less any subtotal or VAT line. An
    invoice with no Total line has no goods lines to count.
    """
    goods = []
    for line in invoice_text.splitlines():
        line = _normalise(line)
        first = line.split(" ")[0]
        if first == "total":
            return goods, _pence(line.split(" ")[-1])
        if first not in ("subtotal", "vat"):
            goods.append(line)
    return [], None


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

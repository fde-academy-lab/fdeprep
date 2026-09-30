"""Reference solution for carry-conflicting-evidence.

Each document is extracted on its own, so every value arrives tied to the id of
the document it came from, and attribution never depends on the model's word.
Values are grouped by field and then by their normalised form. One distinct
value is agreement; two or more is a conflict that carries every candidate and
its sources, and the record holds null for that field.

Dates and document types decide nothing. ready_to_pay needs both bank fields
to hold agreed values, so an empty file is never ready.
"""

import json
import re

FIELDS = ("sort_code", "account_number", "vat_number")
PAYMENT_FIELDS = ("sort_code", "account_number")


def normalise(field: str, value):
    """The comparable form of one value, or None when there is none."""
    if not isinstance(value, str):
        return None
    if field == "vat_number":
        cleaned = re.sub(r"\s+", "", value).upper()
    else:
        cleaned = re.sub(r"\D", "", value)
    return cleaned or None


def extract(llm, text: str) -> dict:
    """The fields one document's text states, as the model wrote them."""
    reply = llm(
        "Read this supplier document. Reply with one JSON object holding "
        "sort_code, account_number and vat_number, written as the document "
        "writes them, and leave out any the document does not state.\n\n"
        f"<document>\n{text}\n</document>\n"
    )
    try:
        found = json.loads(reply)
    except ValueError:
        return {}
    return found if isinstance(found, dict) else {}


def run_agent(question: str, llm, tools: dict) -> str:
    reply = tools["documents"](supplier=question.strip())
    documents = reply.get("documents") if isinstance(reply, dict) else None
    if not isinstance(documents, list):
        documents = []

    # field -> normalised value -> ids of the documents that gave it
    seen = {field: {} for field in FIELDS}
    for document in documents:
        if not isinstance(document, dict) or not isinstance(document.get("text"), str):
            continue
        found = extract(llm, document["text"])
        for field in FIELDS:
            value = normalise(field, found.get(field))
            if value is not None:
                seen[field].setdefault(value, []).append(document.get("id"))

    record, conflicts = {}, []
    for field in FIELDS:
        values = seen[field]
        record[field] = next(iter(values)) if len(values) == 1 else None
        if len(values) > 1:
            conflicts.append({
                "field": field,
                "candidates": [{"value": value, "sources": sources}
                               for value, sources in values.items()],
            })

    ready = not conflicts and all(record[field] for field in PAYMENT_FIELDS)
    return json.dumps({"record": record, "conflicts": conflicts, "ready_to_pay": ready})

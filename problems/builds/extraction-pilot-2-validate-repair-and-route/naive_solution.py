"""What an unprepared learner writes in four minutes.

It validates, and when the record fails it asks again, because a model that
got it wrong once might get it right on a second try. The second prompt is the
first prompt, so the second reply is the first reply, and a record that one
sentence of feedback would have fixed goes to the human queue instead.
"""

import json
import re

FIELDS = ("policy_number", "claimant", "incident_date", "amount_claimed")
POLICY_NUMBER = re.compile(r"^[A-Z]{2}-\d{6}$")
AMOUNT = re.compile(r"^£\d[\d,]*(?:\.\d{2})?$")

EXTRACT = (
    "Read the claim letter below. Reply with one JSON object and nothing else, "
    "with exactly these keys: policy_number, claimant, incident_date, "
    "amount_claimed.\n"
    "Copy each value exactly as the letter writes it. When the letter does not "
    "state a value, use null. Do not work a value out from other information.\n\n"
    "<letter>\n{letter}\n</letter>\n"
)


def run_agent(question: str, llm, tools: dict) -> str:
    prompt = EXTRACT.format(letter=question)
    record = _ground(llm(prompt), question)
    errors = _validate(record)

    if errors:
        record = _ground(llm(prompt), question)
        errors = _validate(record)

    if errors:
        tools["human_queue"](record=record, errors=errors)
        return json.dumps({"status": "queued", "record": record, "errors": errors})

    tools["submit"](record=record)
    return json.dumps({"status": "submitted", "record": record, "errors": []})


def _ground(reply: str, letter: str) -> dict:
    try:
        extracted = json.loads(reply)
    except ValueError:
        extracted = {}
    if not isinstance(extracted, dict):
        extracted = {}
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

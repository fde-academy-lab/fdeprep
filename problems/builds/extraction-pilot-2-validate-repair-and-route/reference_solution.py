"""Reference solution for extraction-pilot-2-validate-repair-and-route.

Grounded is not the same as valid. CLM-20931 is in the letter, so stage 1
keeps it, and it is a claim reference sitting in the policy number field,
which the claims system rejects. Validation runs on the grounded record and
names every rule that failed.

A retry only helps when it asks a different question. The repair prompt
carries the previous reply and the validator's own error lines, which is the
one piece of information the first prompt did not have. The repaired reply is
a new model reply, so it is grounded again before it is validated: a repair
asked to fill a missing policy number will happily invent one.

One repair, then a decision. A record that still fails goes to the human
queue with its errors, which is where a letter that does not contain what the
claims system needs belongs. Nothing is left in an error folder.
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

REPAIR = (
    "{extract}\n"
    "Your previous reply was:\n{reply}\n\n"
    "The claims system rejected it for these reasons:\n{errors}\n\n"
    "Reply with the corrected JSON object. A value the letter does not state "
    "stays null.\n"
)


def run_agent(question: str, llm, tools: dict) -> str:
    prompt = EXTRACT.format(letter=question)
    reply = llm(prompt)
    record = _ground(reply, question)
    errors = _validate(record)

    if errors:
        repair = REPAIR.format(extract=prompt, reply=reply, errors="\n".join(errors))
        record = _ground(llm(repair), question)
        errors = _validate(record)

    if errors:
        tools["human_queue"](record=record, errors=errors)
        status = "queued"
    else:
        tools["submit"](record=record)
        status = "submitted"
    return json.dumps({"status": status, "record": record, "errors": errors})


def _ground(reply: str, letter: str) -> dict:
    """Stage 1: a value survives only when the letter contains it."""
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
    """The claims system's intake rules, one error line per failed rule."""
    errors = [f"{field}: missing" for field in FIELDS if record.get(field) is None]
    policy = record.get("policy_number")
    if policy is not None and not POLICY_NUMBER.match(policy):
        errors.append("policy_number: not a policy number")
    amount = record.get("amount_claimed")
    if amount is not None and not AMOUNT.match(amount):
        errors.append("amount_claimed: not an amount")
    return errors

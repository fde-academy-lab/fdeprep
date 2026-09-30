"""Reference solution for extraction-pilot-1-extract-without-guessing.

The model answers every field because every field was asked for. Its reply
cannot say which values it read and which it wrote, and asking it to use null
lowers the rate without closing the gap. The letter can say. A value the
letter does not contain was not extracted from it.

The comparison ignores case and runs of whitespace, because letters arrive
through scanners and hard-wrapped email, and a name in a capitals signature is
still the name. It ignores nothing else. A date worked out from "Sunday night"
is a calculation, and the adjuster needs to know the letter never gave one.

The record is built from the four field names rather than from the keys the
model sent back, so a missing key becomes null and an extra key never reaches
the claims system.
"""

import json
import re

FIELDS = ("policy_number", "claimant", "incident_date", "amount_claimed")

PROMPT = (
    "Read the claim letter below. Reply with one JSON object and nothing else, "
    "with exactly these keys: policy_number, claimant, incident_date, "
    "amount_claimed.\n"
    "Copy each value exactly as the letter writes it. When the letter does not "
    "state a value, use null. Do not work a value out from other information.\n\n"
    "<letter>\n{letter}\n</letter>\n"
)


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def _parse(reply: str) -> dict:
    try:
        parsed = json.loads(reply)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def run_agent(question: str, llm, tools: dict) -> str:
    letter_text = _normalise(question)
    extracted = _parse(llm(PROMPT.format(letter=question)))

    record = {}
    for field in FIELDS:
        value = extracted.get(field)
        if isinstance(value, str) and value.strip() and _normalise(value) in letter_text:
            record[field] = value.strip()
        else:
            record[field] = None
    return json.dumps(record)

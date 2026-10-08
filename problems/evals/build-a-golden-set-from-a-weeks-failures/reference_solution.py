"""Reference solution for build-a-golden-set-from-a-weeks-failures.

A golden case promises one right answer, decided by a person, to a question
the release has not seen. Every step below protects one part of that promise.

The scrub runs on the free text, because that is where customers write their
details, spelled however they like: emails, then phone numbers, by pattern,
then the customer's name and each word of it as whole words in any case.

One key decides what counts as the same case, and it is used for both
questions: whether two failures are copies, and whether a failure is a ticket
the prompt or the fine-tuning set already contains. Numbers, capitals and
spacing make no new case.

The order of the steps sets the counts. Unfixed failures go first, so an
unfixed copy cannot stand in for a fixed one. Copies merge before the quota,
so a template cannot take every slot of its type. A group fixed two
different ways has no right answer yet, so all of it is left out.

When the known examples cannot be read, nothing is built, because a golden
set whose contamination check never ran would report a clean number it never
measured.
"""

import json
import re

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\d)(?:\+91[ -]?|0)?[6-9](?:[ -]?\d){9}(?!\d)")
NUMBER = re.compile(r"\d[\d,.]*\d|\d")

NOTHING = {"cases": None, "left_out": None}


def scrub(text: str, customer) -> str:
    """The text with personal data replaced, in the policy's order."""
    text = EMAIL.sub("<EMAIL>", text)
    text = PHONE.sub("<PHONE>", text)
    name = customer.get("name") if isinstance(customer, dict) else None
    if isinstance(name, str) and name.strip():
        # The whole name first, then each word of it, longest first.
        parts = [name.strip()] + sorted(set(name.split()), key=len, reverse=True)
        for part in parts:
            text = re.sub(rf"\b{re.escape(part)}\b", "<NAME>", text, flags=re.I)
    return text


def key(text: str) -> str:
    """What decides that two texts are the same case."""
    return re.sub(r"\s+", " ", NUMBER.sub("#", text.lower())).strip()


def label(failure: dict):
    """The action the person who fixed the failure chose, or None."""
    resolution = failure.get("resolution")
    if isinstance(resolution, dict):
        action = resolution.get("action")
        if isinstance(action, str) and action.strip():
            return action
    return None


def run_agent(question: str, llm, tools: dict) -> str:
    try:
        week = tools["failures"](week=question)
        known = tools["known_examples"]()
    except Exception:
        return json.dumps(NOTHING)
    readable = (isinstance(week, dict) and isinstance(week.get("failures"), list)
                and isinstance(week.get("per_type"), int) and week["per_type"] >= 1
                and isinstance(known, dict) and isinstance(known.get("examples"), list))
    if not readable:
        return json.dumps(NOTHING)

    known_keys = {key(example) for example in known["examples"] if isinstance(example, str)}
    left_out = {"unlabelled": 0, "already_known": 0, "duplicates": 0,
                "conflicting": 0, "over_quota": 0}

    groups = {}           # key -> [(failure, scrubbed text, label)], in arrival order
    for failure in week["failures"]:
        if not isinstance(failure, dict):
            continue
        text = scrub(str(failure.get("text", "")), failure.get("customer"))
        chosen = label(failure)
        if chosen is None:
            left_out["unlabelled"] += 1
            continue
        same = key(text)
        if same in known_keys:
            left_out["already_known"] += 1
            continue
        groups.setdefault(same, []).append((failure, text, chosen))

    # Dicts keep insertion order, so the groups run in the order their first
    # copy arrived.
    kept = []
    for members in groups.values():
        if len({chosen for _, _, chosen in members}) > 1:
            left_out["conflicting"] += len(members)
            continue
        left_out["duplicates"] += len(members) - 1
        kept.append(members[0])

    taken, cases = {}, []
    for failure, text, chosen in kept:
        kind = failure.get("type")
        if taken.get(kind, 0) >= week["per_type"]:
            left_out["over_quota"] += 1
            continue
        taken[kind] = taken.get(kind, 0) + 1
        cases.append({"id": failure.get("id"), "type": kind, "input": text,
                      "expected": chosen})

    return json.dumps({"cases": cases, "left_out": left_out})

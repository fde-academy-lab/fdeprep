"""What an unprepared learner writes in four minutes.

It does every step the brief names, in a reasonable order, and treats "the
same case" as "the same text". So it scrubs the customer's details exactly as
the record spells them, and a name written in lower case, a first name on its
own, or a phone number with its spaces moved survives into the golden set. It
deduplicates and checks the prompt's examples by exact text, so the same
templated complaint with a different order number counts as a new case, and
a ticket the prompt was written from gets back in with its numbers changed.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    week = tools["failures"](week=question)
    known = set(tools["known_examples"]()["examples"])
    per_type = week["per_type"]

    left_out = {"unlabelled": 0, "already_known": 0, "duplicates": 0,
                "conflicting": 0, "over_quota": 0}
    cases, seen, taken = [], set(), {}

    for failure in week["failures"]:
        customer = failure["customer"]
        text = (failure["text"]
                .replace(customer["email"], "<EMAIL>")
                .replace(customer["phone"], "<PHONE>")
                .replace(customer["name"], "<NAME>"))
        if not failure.get("resolution"):
            left_out["unlabelled"] += 1
            continue
        if text in known:
            left_out["already_known"] += 1
            continue
        if text in seen:
            left_out["duplicates"] += 1
            continue
        seen.add(text)
        if taken.get(failure["type"], 0) >= per_type:
            left_out["over_quota"] += 1
            continue
        taken[failure["type"]] = taken.get(failure["type"], 0) + 1
        cases.append({"id": failure["id"], "type": failure["type"], "input": text,
                      "expected": failure["resolution"]["action"]})

    return json.dumps({"cases": cases, "left_out": left_out})

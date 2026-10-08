"""What an unprepared learner writes in four minutes.

Lookups with no references go in the first round and everything else in the
second, which is right for every plan two levels deep. The brief is written
in the order results come back. A policy check that needs a room rate that
needs a hotel runs before its rate exists, and a brief whose lookups finish
out of section order comes out in the wrong order.
"""

import json
import re

REFERENCE = re.compile(r"^\$([a-z_]+)\.([a-z_]+)$")


def plan_prompt(request: str) -> str:
    return (
        "Plan the lookups for a trip brief. The lookups are flight, fare_rules, "
        "hotel, room_rate, visa and policy. Write an argument that needs another "
        'lookup\'s result as "$<id>.<field>". Reply with one line: '
        'Plan: {"lookups": [{"id": ..., "args": {...}}]}\n'
        f"Request: {request}\n"
    )


def parse_plan(reply: str) -> list:
    text = reply.strip()
    if text.startswith("Plan:"):
        text = text[len("Plan:"):]
    return list(json.loads(text).get("lookups") or [])


def needs(lookup: dict) -> list:
    found = []
    for value in (lookup.get("args") or {}).values():
        match = REFERENCE.match(value) if isinstance(value, str) else None
        if match and match.group(1) not in found:
            found.append(match.group(1))
    return found


def fill(args: dict, results: dict) -> dict:
    filled = {}
    for key, value in args.items():
        match = REFERENCE.match(value) if isinstance(value, str) else None
        if match and match.group(1) in results:
            filled[key] = results[match.group(1)].get(match.group(2))
        else:
            filled[key] = value
    return filled


def run_agent(question: str, llm, tools: dict) -> str:
    lookups = parse_plan(llm(plan_prompt(question)))
    first = [lookup for lookup in lookups if not needs(lookup)]
    second = [lookup for lookup in lookups if needs(lookup)]

    results, arrived = {}, []
    for batch in (first, second):
        if not batch:
            continue
        sent = [{"id": lookup["id"], "args": fill(lookup["args"], results)} for lookup in batch]
        for result in tools["run_round"](lookups=sent)["results"]:
            results[result["id"]] = result
            arrived.append(result["id"])

    return "\n".join(f"{name}: {results[name]['summary']}" for name in arrived)

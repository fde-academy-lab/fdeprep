"""Reference solution for run-independent-lookups-together.

The plan is a graph whose edges are its references. Each lookup gets the
earliest round it can run in, one after the latest round among the lookups
it refers to, so independent lookups share round 1 and the number of rounds
is the longest chain of references. Results are kept by id, and the brief is
built by walking SECTIONS, so the order lookups finish in never reaches it.
"""

import json
import re

SECTIONS = ("policy", "flight", "fare_rules", "hotel", "room_rate", "visa")
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


def assign_rounds(lookups: list) -> dict:
    """Each lookup's id mapped to the earliest round it can run in.

    Passes over the plan until a pass assigns nothing new, because the plan
    may list a lookup before the lookups it refers to. A lookup whose
    references never resolve, which the contract rules out, gets no round
    and never runs.
    """
    rounds: dict = {}
    pending = list(lookups)
    while pending:
        assigned = []
        for lookup in pending:
            wanted = needs(lookup)
            if all(name in rounds for name in wanted):
                rounds[lookup["id"]] = 1 + max((rounds[name] for name in wanted), default=0)
                assigned.append(lookup)
        if not assigned:
            break
        pending = [lookup for lookup in pending if lookup not in assigned]
    return rounds


def run_agent(question: str, llm, tools: dict) -> str:
    lookups = parse_plan(llm(plan_prompt(question)))
    rounds = assign_rounds(lookups)

    results: dict = {}
    for number in range(1, max(rounds.values(), default=0) + 1):
        batch = [lookup for lookup in lookups if rounds.get(lookup["id"]) == number]
        sent = [{"id": lookup["id"], "args": fill(lookup.get("args") or {}, results)}
                for lookup in batch]
        reply = tools["run_round"](lookups=sent) or {}
        asked = {lookup["id"] for lookup in batch}
        for result in reply.get("results") or []:
            if isinstance(result, dict) and result.get("id") in asked:
                results[result["id"]] = result

    lines = [f"{section}: {results[section].get('summary', '')}"
             for section in SECTIONS if section in results]
    return "\n".join(lines)

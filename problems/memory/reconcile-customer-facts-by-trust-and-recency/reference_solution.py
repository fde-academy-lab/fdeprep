"""Reference solution for reconcile-customer-facts-by-trust-and-recency.

Trust decides, and the date only breaks a tie inside one source. A call-back
outranks a support agent's note, which outranks something the customer wrote
in chat, whatever the dates say. The date says when a record arrived; the
source says how anybody knows it is true.

A weaker record that is newer than the fact and disagrees with it is held back
and shown as unconfirmed. Dropping it would lose a customer's real change of
account. Applying it is how the settlement went to the wrong place. Showing it
lets a person confirm it before anything is paid.

Two values are the same when they match after trimming spaces and ignoring
case, so a customer retyping their address in lower case is agreement.
"""

import json
import re

TRUST = {"verified": 1, "agent": 2, "chat": 3}


def _rank(record: dict) -> int:
    return TRUST.get(record.get("source"), len(TRUST) + 1)


def _same_value(a, b) -> bool:
    return str(a).strip().lower() == str(b).strip().lower()


def _beats(challenger: dict, holder: dict) -> bool:
    if _rank(challenger) != _rank(holder):
        return _rank(challenger) < _rank(holder)
    return str(challenger.get("at", "")) > str(holder.get("at", ""))


def _reconcile(records: list):
    facts = {}
    for record in records:
        field = record.get("field")
        if field not in facts or _beats(record, facts[field]):
            facts[field] = record

    held = []
    for record in records:
        fact = facts[record.get("field")]
        if (
            _rank(record) > _rank(fact)
            and str(record.get("at", "")) > str(fact.get("at", ""))
            and not _same_value(record.get("value"), fact.get("value"))
        ):
            held.append(record)
    return facts, held


def run_agent(question: str, llm, tools: dict) -> str:
    records = (tools["facts"]() or {}).get("records") or []
    facts, held = _reconcile(records)

    lines = ["Customer facts:"]
    lines += [f"{field}: {record.get('value')}" for field, record in facts.items()]
    lines += [f"unconfirmed {record.get('field')}: {record.get('value')}" for record in held]
    lines.append(f"Question: {question}")
    return llm("\n".join(lines)).strip()

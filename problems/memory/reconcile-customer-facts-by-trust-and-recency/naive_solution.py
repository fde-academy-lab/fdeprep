"""What an unprepared learner writes in four minutes.

Last write wins. Records are sorted by date and each field takes the newest
value, which is how most profile tables work. A chat message from last week
beats a call-back from March because it is newer, and nothing else about the
two records is ever read.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    records = (tools["facts"]() or {}).get("records") or []

    facts = {}
    for record in sorted(records, key=lambda r: r.get("at", "")):
        facts[record.get("field")] = record.get("value")

    lines = ["Customer facts:"]
    lines += [f"{field}: {value}" for field, value in facts.items()]
    lines.append(f"Question: {question}")
    return llm("\n".join(lines)).strip()

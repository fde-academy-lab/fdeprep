"""What an unprepared learner writes in four minutes.

Age first, then the exceptions, which is the order the rules were written in
and the order they read in the ticket. A pin saves a record from anything,
including an erasure request, and a record an open task depends on is removed
on age without anybody being told.
"""

import json
import re

MAX_AGE_DAYS = 30


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Sweep: {question}\n"
    report = {"kept": [], "removed": [], "blocked_tasks": [], "note": ""}

    for _ in range(8):
        output = llm(scratchpad)

        if "Action:" not in output:
            report["note"] = output.strip()
            return json.dumps(report)

        action = re.search(r"Action:\s*(\w+)\(", output, re.MULTILINE)
        if action is None:
            continue

        result = tools[action.group(1)]() or {}
        records = result.get("records") or []

        for record in records:
            if record.get("pinned"):
                report["kept"].append(record.get("id"))
            elif int(record.get("age_days", 0)) > MAX_AGE_DAYS:
                report["removed"].append(record.get("id"))
            elif record.get("deletion_requested"):
                report["removed"].append(record.get("id"))
            else:
                report["kept"].append(record.get("id"))

        return json.dumps(report)

    return json.dumps(report)

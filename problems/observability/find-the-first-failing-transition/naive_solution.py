"""What an unprepared learner writes in four minutes.

It scans for errors and reports the last one, because the last error is the
one with the stack trace and the one the incident channel is already talking
about. Empty observations and repeated calls are not errors, so it does not
see them at all.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Run: {question}\n"
    report = {"first_failure": None, "kind": None, "later_symptoms": [], "note": ""}

    for _ in range(8):
        output = llm(scratchpad)

        if "Action:" not in output:
            report["note"] = output.strip()
            return json.dumps(report)

        action = re.search(r"Action:\s*(\w+)\(", output, re.MULTILINE)
        if action is None:
            continue

        result = tools[action.group(1)]() or {}
        errors = [s for s in (result.get("steps") or []) if s.get("type") == "error"]

        if errors:
            report["first_failure"] = errors[-1].get("n")
            report["kind"] = "error"

        scratchpad += (
            f"{output}\nFirst broken step: {report['first_failure']} "
            f"({report['kind']}). Write one line an on-call engineer can read.\n"
        )

    return json.dumps(report)

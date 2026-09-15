"""Reference solution for expire-context-without-abandoning-work.

Five rules, and the order is the whole problem.

Erasure goes first because it is the only rule in the table this team did not
choose. Dependency goes above age because age is a proxy for "nobody needs
this" and an open task is direct evidence against it.

The blocked-task list does not change what is deleted. It changes what a
person finds out, which is the difference between a silent corruption and a
decision. The model is asked for the operator message only when there is one,
because this job runs nightly over every case.
"""

import json
import re

MAX_AGE_DAYS = 30
_ACTION = re.compile(r"Action:\s*(\w+)\(", re.MULTILINE)


def _decide(record: dict, active: set) -> str:
    if record.get("deletion_requested"):
        return "removed"
    if active & set(record.get("needed_by") or []):
        return "kept"
    if record.get("pinned"):
        return "kept"
    if int(record.get("age_days", 0)) > MAX_AGE_DAYS:
        return "removed"
    return "kept"


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Sweep: {question}\n"
    report = {"kept": [], "removed": [], "blocked_tasks": [], "note": ""}

    for _ in range(8):
        output = llm(scratchpad)

        if "Action:" not in output:
            report["note"] = output.strip()
            return json.dumps(report)

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        result = tools[action.group(1)]() or {}
        records = result.get("records")
        if not isinstance(records, list):
            report["note"] = (
                "The case store returned no record list, so nothing was swept. "
                "Erasure requests due today are still outstanding."
            )
            return json.dumps(report)

        active = set(result.get("active_tasks") or [])
        survivors = {task: 0 for task in active}

        for record in records:
            outcome = _decide(record, active)
            report[outcome].append(record.get("id"))
            if outcome == "kept":
                for task in set(record.get("needed_by") or []) & active:
                    survivors[task] += 1

        report["blocked_tasks"] = sorted(task for task, left in survivors.items() if left == 0)

        if not report["blocked_tasks"]:
            return json.dumps(report)

        scratchpad += (
            f"{output}\nThese active tasks are blocked with no records left: "
            f"{', '.join(report['blocked_tasks'])}. Write one line for the operator.\n"
        )

    return json.dumps(report)

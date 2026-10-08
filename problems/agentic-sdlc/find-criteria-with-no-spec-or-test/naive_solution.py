"""What an unprepared learner writes in four minutes.

It builds one set of every id that any section or test mentions, and calls a
criterion covered when its id is in the set. The sections and tests listed
for each criterion are right, so the trace looks right. The gaps are not: a
criterion that only a section names is in the set and reports no gap, and a
reference to a criterion that does not exist is never reported. Two criteria
that share an id both look covered.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    spec = tools["spec"]()
    mentioned = set()
    for section in spec["sections"]:
        mentioned.update(section["covers"])
    for test in spec["tests"]:
        mentioned.update(test["criteria"])

    report = []
    for criterion in spec["criteria"]:
        cid = criterion["id"]
        report.append({
            "id": cid,
            "sections": [s["id"] for s in spec["sections"] if cid in s["covers"]],
            "tests": [t["id"] for t in spec["tests"] if cid in t["criteria"]],
            "gaps": [] if cid in mentioned else ["no_section", "no_test"],
        })
    complete = all(not entry["gaps"] for entry in report)
    return json.dumps({"criteria": report, "unknown_refs": [], "complete": complete})

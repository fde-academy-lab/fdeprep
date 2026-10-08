"""Reference solution for deliver-in-bolts-3-pick-the-planning-path.

Planning follows reach, so the line count is the last thing asked. A change
that edits a field an external contract lists goes down the project path
however small it is, because another team's system reads that field. So does
a change across two units, whose reviews and owners both have to agree, and a
change that needs a unit nobody accepted.

Only a change inside one unit, clear of every contract, is sized by its lines.
The contract fields come from contracts() on every run, since the teams that
own the APIs keep that list, and a field counts only when a contract lists it
by exact name.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    contract_fields = {field for fields in tools["contracts"]().values() for field in fields}
    paths = []
    for change in tools["changes"]():
        if any(field in contract_fields for field in change["fields"]):
            path, rule = "project", "contract"
        elif len(change["units"]) > 1:
            path, rule = "project", "units"
        elif not change["units"]:
            path, rule = "project", "new_unit"
        elif change["lines"] <= 10:
            path, rule = "skip", "lines"
        else:
            path, rule = "epic", "lines"
        paths.append({"id": change["id"], "path": path, "rule": rule})
    return json.dumps({"paths": paths})

"""What an unprepared learner writes in four minutes.

It sizes each change the way the construction agent did, by its diff: ten
lines or fewer skips planning, more is an epic, and a change with no unit is a
project. Every public change sits inside one unit and edits no contract field,
so both public cases pass. CR-5 and CR-9 are one and two lines, so both skip
planning while another team's API reads the fields they edit, and CR-6 is an
epic although two units share the table it moves.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    paths = []
    for change in tools["changes"]():
        if not change["units"]:
            path, rule = "project", "new_unit"
        elif change["lines"] <= 10:
            path, rule = "skip", "lines"
        else:
            path, rule = "epic", "lines"
        paths.append({"id": change["id"], "path": path, "rule": rule})
    return json.dumps({"paths": paths})

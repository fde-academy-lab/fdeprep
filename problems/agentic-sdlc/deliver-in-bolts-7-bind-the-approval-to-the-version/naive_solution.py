"""What an unprepared learner writes in four minutes.

It reads the approval, checks that the version it names is the artefact's
current version, and checks that every id it cites is in the audit trail.
Then it merges. APR-1 is refused for naming v3 while uow-1 is at v4, and
APR-2 merges on RUN-42, RV-6 and ADR-1, so both public cases pass.

It never asks what each cited entry was about or who may approve. A test run
of v3, or of another unit, counts for v4 because it exists, an approval that
cites no test run at all merges, and an engineer's approval is as good as a
reviewer's.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    approval = tools["approvals"](id=question)
    current = tools["artefacts"](artefact=approval["artefact"])["current"]
    known = {entry["id"] for entry in tools["trail"]()}

    check = failed = None
    missing = [ref for ref in approval["evidence"] if ref not in known]
    if approval["version"] != current:
        check, failed = "version", approval["version"]
        reason = f"{question} names {approval['version']}, and the artefact is at {current}"
    elif missing:
        check, failed = "evidence", missing[0]
        reason = f"{missing[0]} is not in the audit trail"
    else:
        tools["merge"](artefact=approval["artefact"], version=approval["version"])
        reason = f"{question} names the current version and all its evidence exists"

    return json.dumps({"kind": "APPROVAL_DECIDED", "ref": question,
                       "artefact": approval["artefact"], "version": approval["version"],
                       "decision": "refused" if check else "merged",
                       "check": check, "failed": failed, "reason": reason})

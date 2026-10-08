"""What an unprepared learner writes in four minutes.

It keeps each change's last version and last approval, then checks the
approval against that version: the same artefact and number, an approver who
is not the version's author, some evidence, and evidence listed for the
change. Each of September's three bolts would have been held.

It never reads when anything happened, so an approval given before the
version it names was written passes. It checks the approver against one
author when several people can have written a change, and a sign-off the
author adds later hides a good approval given before it. An approval for a
change outside the bolt disappears without a word.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    log = tools["bolt"]()
    last_version = {}
    last_approval = {}
    for event in log["events"]:
        if event["kind"] == "version":
            last_version[event["change"]] = event
        else:
            last_approval[event["change"]] = event

    changes = {}
    for change, version in last_version.items():
        approval = last_approval.get(change)
        if approval is None:
            state = "unapproved"
        elif (approval["artefact"], approval["version"]) != (version["artefact"], version["version"]):
            state = "stale"
        elif approval["by"] == version["author"]:
            state = "self_approved"
        elif not approval["evidence"]:
            state = "no_evidence"
        elif not any(change in item["for"] for item in approval["evidence"]):
            state = "wrong_evidence"
        else:
            state = "approved"
        changes[change] = {"state": state, "reason": f"{change} is {state}"}

    decision = "proceed" if all(c["state"] == "approved" for c in changes.values()) else "hold"
    return json.dumps({"bolt": log["bolt"], "decision": decision,
                       "changes": changes, "ignored": []})

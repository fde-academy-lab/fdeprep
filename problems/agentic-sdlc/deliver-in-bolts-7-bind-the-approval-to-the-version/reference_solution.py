"""Reference solution for deliver-in-bolts-7-bind-the-approval-to-the-version.

An approval is a statement about one version of one artefact. It counts when
that version is the one the artefact is at now, when every piece of evidence
it cites was produced against that same artefact and version, and when the
person who gave it may approve a merge.

Evidence is bound by its trail entry. A test run, a review or a review
comment names the artefact and version it was about, and anything else is
evidence about something else, however real. A decision record names the
method and no version, so it may be cited and proves nothing on its own: the
approval still needs a test run of the version it approves.

The gate acts on its own decision. It merges only when all three checks hold,
writes the event either way, and builds the reason from ids, versions and
roles, so nothing a person wrote in a trail entry reaches the next reader.
"""

import json

BOUND = ("test run", "review", "review comment")


def _evidence(approval, trail):
    """The first cited id that fails and why, or None and why no test run counts."""
    runs = 0
    for ref in approval["evidence"]:
        entry = trail.get(ref)
        if entry is None:
            return ref, f"{ref} is not in the audit trail"
        if entry["kind"] not in BOUND:
            continue
        if (entry["artefact"], entry["version"]) != (approval["artefact"], approval["version"]):
            return ref, (f"{ref} is bound to {entry['artefact']} {entry['version']}, "
                         f"not {approval['artefact']} {approval['version']}")
        runs += entry["kind"] == "test run"
    if not runs:
        return None, f"no test run of {approval['artefact']} {approval['version']} is cited"
    return None, ""


def run_agent(question: str, llm, tools: dict) -> str:
    approval = tools["approvals"](id=question)
    artefact, version, approver = approval["artefact"], approval["version"], approval["approver"]
    current = tools["artefacts"](artefact=artefact)["current"]
    trail = {entry["id"]: entry for entry in tools["trail"]()}
    role = tools["roles"]().get(approver)

    failed, problem = _evidence(approval, trail)
    if version != current:
        check, failed = "version", version
        reason = f"{question} approves {artefact} {version}, and {artefact} is at {current}"
    elif problem:
        check, reason = "evidence", problem
    elif role != "reviewer":
        check, failed = "role", approver
        reason = f"{approver} holds {role}, and only a reviewer may approve a merge"
    else:
        tools["merge"](artefact=artefact, version=version)
        check = None
        reason = (f"{approver} approved {artefact} {version}, its current version, citing "
                  f"{', '.join(approval['evidence'])}")

    return json.dumps({"kind": "APPROVAL_DECIDED", "ref": question, "artefact": artefact,
                       "version": version, "decision": "refused" if check else "merged",
                       "check": check, "failed": failed, "reason": reason})

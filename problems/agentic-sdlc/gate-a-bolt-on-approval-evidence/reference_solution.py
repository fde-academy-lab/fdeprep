"""Reference solution for gate-a-bolt-on-approval-evidence.

An approval is an event. It covers the version it names, judged against the
change as it stood at that moment, and it stops covering the change when a
newer version arrives. So the gate keeps each change's versions in log order
and judges every approval against them at the approval's own time.

A change is approved when any one of its approvals holds. The first approval
can be stale and the last can be the author's own sign-off, so neither one
decides alone. When none holds, the most recent says what the team is
waiting on.

Independence covers the whole change: whoever directed the agent on any
version of it is one of its authors. Evidence counts for the changes its
`for` lists and no others, and its source text is never read or copied.
"""

import json


def _judge(approval, versions):
    """One approval's state and reason, against its change's versions in log order."""
    t, change, by = approval["t"], approval["change"], approval.get("by")
    named = (approval.get("artefact"), approval.get("version"))
    had = [(v["artefact"], v["version"]) for v in versions if v["t"] < t]
    if named not in had:
        return None, f"the approval at t={t} names version {named[1]}, which {change} did not have yet"
    last = versions[-1]
    if last["t"] > t or named != had[-1]:
        return "stale", (f"the approval at t={t} covers version {named[1]}, and {change} "
                         f"has been at version {last['version']} since t={last['t']}")
    authors = {v["author"] for v in versions}
    if by in authors:
        return "self_approved", f"{by} approved {change} at t={t} and wrote a version of it"
    evidence = approval.get("evidence") or []
    if not evidence:
        return "no_evidence", f"the approval at t={t} cites no evidence"
    if not any(change in (item.get("for") or []) for item in evidence):
        return "wrong_evidence", f"nothing the approval at t={t} cites is evidence for {change}"
    return "approved", f"{by} approved version {named[1]} at t={t} with evidence for {change}"


def run_agent(question: str, llm, tools: dict) -> str:
    log = tools["bolt"]() or {}
    events = log.get("events") or []

    versions = {}
    for event in events:
        if event.get("kind") == "version":
            versions.setdefault(event["change"], []).append(event)

    judged = {change: [] for change in versions}
    ignored = []
    for event in events:
        if event.get("kind") != "approval":
            continue
        if event.get("change") not in versions:
            ignored.append(event["t"])
            continue
        judged[event["change"]].append(_judge(event, versions[event["change"]]))

    changes = {}
    for change, verdicts in judged.items():
        counted = [v for v in verdicts if v[0] is not None]
        held = [v for v in counted if v[0] == "approved"]
        if held:
            state, reason = held[0]
        elif counted:
            state, reason = counted[-1]
        else:
            voids = [reason for _, reason in verdicts]
            state, reason = "unapproved", voids[-1] if voids else f"nobody has approved {change}"
        changes[change] = {"state": state, "reason": reason}

    decision = "proceed" if all(c["state"] == "approved" for c in changes.values()) else "hold"
    return json.dumps({"bolt": log.get("bolt"), "decision": decision,
                       "changes": changes, "ignored": ignored})

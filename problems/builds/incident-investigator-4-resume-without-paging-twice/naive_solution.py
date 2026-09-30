"""What an unprepared learner writes in four minutes.

It checkpoints, resumes from the checkpoint, and pages when the checkpoint
does not say the page was sent, which reads as exactly the right logic. The
page is recorded as sent only after the call returns, so a process that dies
in between leaves a checkpoint that says nothing was sent, and the restart
pages again. It also resumes from whatever state the store hands back,
whichever incident that state belongs to.
"""

import json

RUNBOOK = ("deploys", "logs", "metrics")

FINDING = (
    "Incident {incident}. One line per check, in the order they were started:\n"
    "{lines}\n"
    "Write the finding for the on-call engineer in two sentences.\n"
)


def run_agent(question: str, llm, tools: dict) -> str:
    alert = json.loads(question)
    incident = alert["incident"]

    state = tools["checkpoint_load"](incident=incident)["data"]["state"]
    if state and state.get("lines"):
        lines, cause, resumed = state["lines"], state.get("cause"), True
    else:
        lines, cause = _investigate(alert, tools)
        resumed = False
        state = {"incident": incident, "lines": lines, "cause": cause, "page": None}
        tools["checkpoint_save"](incident=incident, state=state)

    page = "not_needed"
    if cause:
        if (state.get("page") or {}).get("state") == "sent":
            page = "already_sent"
        else:
            key = f"{incident}/page/{cause['owner']}"
            tools["page"](team=cause["owner"], key=key, incident=incident,
                          finding=cause["finding"])
            state["page"] = {"key": key, "state": "sent"}
            tools["checkpoint_save"](incident=incident, state=state)
            page = "sent"

    finding = llm(FINDING.format(incident=incident, lines="\n".join(lines)))
    return json.dumps({"finding": finding, "resumed": resumed, "page": page})


def _investigate(alert, tools):
    """Stages 1 to 3. Returns (lines, cause), where cause is the definitive
    result's {"finding", "owner"} or None."""
    incident = alert["incident"]
    allowance = int(alert.get("follow_up_allowance", 4))

    jobs = []
    for service in alert["services"]:
        for check in RUNBOOK:
            job = f"{incident}/{check}/{service}"
            tools["dispatch"](job=job, check=check, service=service)
            jobs.append((job, check, service))

    mine = {job for job, _, _ in jobs}
    by_job = {}
    for result in (tools["collect"]() or {}).get("results") or []:
        job = result.get("job") if isinstance(result, dict) else None
        if job in mine and job not in by_job:
            by_job[job] = result

    lines, leads, cause = [], [], None
    for job, check, service in jobs:
        result = by_job.get(job)
        if result is None:
            lines.append(f"{check} {service}: no result")
            continue
        verdict = result.get("verdict", "clear")
        lines.append(f"{check} {service}: {verdict}: {result.get('finding', '')}")
        if verdict == "definitive" and cause is None:
            cause = _cause(result)
        elif verdict == "lead" and result.get("next"):
            leads.append((f"{check} {service}", _steps(result)))

    if cause is None:
        cause = _follow_up_fairly(leads, allowance, tools, lines)
    return lines, cause


def _cause(result: dict) -> dict:
    return {"finding": result.get("finding", ""), "owner": result.get("owner")}


def _steps(result: dict) -> list:
    return [(step["check"], step.get("args") or {}) for step in result.get("next") or []]


def _follow_up_fairly(leads, allowance, tools, lines):
    """Stage 3: leads take turns under one allowance. Returns the cause or None."""
    spent = 0
    while spent < allowance and any(queue for _, queue in leads):
        for _, queue in leads:
            if not queue or spent >= allowance:
                continue
            check, args = queue.pop(0)
            if check not in tools:
                lines.append(f"{check}: skipped: no such check")
                continue
            spent += 1
            try:
                result = tools[check](**args) or {}
            except Exception:
                lines.append(f"{check}: failed")
                continue
            verdict = result.get("verdict", "clear")
            lines.append(f"{check}: {verdict}: {result.get('finding', '')}")
            if verdict == "definitive":
                return _cause(result)
            queue[0:0] = _steps(result)
    for label, queue in leads:
        if queue:
            lines.append(f"{label}: {len(queue)} follow-ups not run")
    return None

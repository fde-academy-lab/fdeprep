"""Reference solution for incident-investigator-4-resume-without-paging-twice.

A checkpoint records what this process believed when it saved. The pager
records what actually happened. The Sunday bug lived between the two: the
page went out, the process died before the save, and the restart believed
the checkpoint. No ordering of two writes closes that gap, so the design
makes the gap visible and then asks about it.

"sending" is saved before the page and "sent" after. A restart that finds
"sending" is standing in the gap, so it asks page_status, which can answer.
A page call that raises puts the same run in the same gap. An answer with no
delivered flag is neither yes nor no, so nobody is paged and the result says
so: a person who reads "unknown" can check in a minute, and a second page
cannot be taken back.

The checkpoint is a tool result like any other and can be wrong with total
confidence. A state for another incident is ignored, and nothing a status
reply says reaches the model's prompt.
"""

import json

RUNBOOK = ("deploys", "logs", "metrics")

FINDING = (
    "Incident {incident}. One line per check, in the order they were started:\n"
    "{lines}\n"
    "Write the finding for the on-call engineer in two sentences: the cause "
    "and the service it is on if a check found one, otherwise the strongest "
    "lead.\n"
)


def run_agent(question: str, llm, tools: dict) -> str:
    alert = json.loads(question)
    incident = alert["incident"]

    state = _load(tools, incident)
    resumed = state is not None and isinstance(state.get("lines"), list)
    if resumed:
        lines, cause = state["lines"], state.get("cause")
    else:
        lines, cause = _investigate(alert, tools)
        state = {"incident": incident, "lines": lines, "cause": cause, "page": None}
        _save(tools, incident, state)

    page = _page_once(tools, incident, state, cause)
    finding = llm(FINDING.format(incident=incident, lines="\n".join(lines)))
    return json.dumps({"finding": finding, "resumed": resumed, "page": page})


def _load(tools, incident):
    """This incident's saved state, or None. Anything else is not ours."""
    reply = tools["checkpoint_load"](incident=incident)
    data = reply.get("data") if isinstance(reply, dict) else None
    state = data.get("state") if isinstance(data, dict) else None
    if isinstance(state, dict) and state.get("incident") == incident:
        return state
    return None


def _save(tools, incident, state):
    tools["checkpoint_save"](incident=incident, state=state)


def _page_once(tools, incident, state, cause) -> str:
    if not isinstance(cause, dict) or not cause.get("owner"):
        return "not_needed"
    owner = cause["owner"]
    record = state.get("page") or {}
    key = record.get("key") or f"{incident}/page/{owner}"

    if record.get("state") == "sent":
        return "already_sent"
    if record.get("state") == "sending":
        delivered = _delivered(tools, key)
        if delivered is None:
            return "unknown"
        if delivered:
            state["page"] = {"key": key, "state": "sent"}
            _save(tools, incident, state)
            return "already_sent"
        # Not delivered: the page never left, and the owner still needs it.

    state["page"] = {"key": key, "state": "sending"}
    _save(tools, incident, state)
    try:
        tools["page"](team=owner, key=key, incident=incident,
                      finding=cause.get("finding", ""))
    except Exception:
        # The request may have reached the provider before the call failed.
        # Paging again here is the Sunday bug without a restart, so ask.
        if _delivered(tools, key) is not True:
            return "unknown"
    state["page"] = {"key": key, "state": "sent"}
    _save(tools, incident, state)
    return "sent"


def _delivered(tools, key):
    """True or False from the provider, or None when its answer is neither."""
    try:
        reply = tools["page_status"](key=key)
    except Exception:
        return None
    flag = reply.get("delivered") if isinstance(reply, dict) else None
    return flag if isinstance(flag, bool) else None


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

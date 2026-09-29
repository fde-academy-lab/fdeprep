"""Reference solution for incident-investigator-3-share-one-budget-across-workers.

A shared allowance with a remaining-balance check is only a ceiling. It stops
the investigation spending too much in total and says nothing about who gets
to spend it, so the first lead in the queue can take every call. The log
worker asking for forty traces is not misbehaving; it is doing its job, and
it happens to be first.

Fairness is a scheduling order. Each lead keeps its own queue, and the leads
take turns, one follow-up per turn, in dispatch order. A lead waiting for its
first follow-up always goes before a lead asking for its fifth, so the deploy
worker's single diff runs in the first round, no matter how noisy the log
worker is.

A follow-up that raises is a spent call and a line in the evidence. Letting
the exception out would lose the whole investigation to one worker's tool,
including the next lead's turn, which is the same starvation by a different
route.
"""

import json

RUNBOOK = ("deploys", "logs", "metrics")

FINDING = (
    "Incident {incident}. One line per check, in the order they were started:\n"
    "{lines}\n"
    "Write the finding for the on-call engineer in two sentences: the cause "
    "and the service it is on if a check found one, otherwise the strongest "
    "lead. Say which checks did not report or were not run.\n"
)


def run_agent(question: str, llm, tools: dict) -> str:
    alert = json.loads(question)
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

    evidence, leads, definitive = [], [], False
    for job, check, service in jobs:
        result = by_job.get(job)
        if result is None:
            evidence.append(f"{check} {service}: no result")
            continue
        verdict = result.get("verdict", "clear")
        evidence.append(f"{check} {service}: {verdict}: {result.get('finding', '')}")
        if verdict == "definitive":
            definitive = True
        elif verdict == "lead" and result.get("next"):
            leads.append((f"{check} {service}", _steps(result)))

    if not definitive:
        _follow_up_fairly(leads, allowance, tools, evidence)

    return llm(FINDING.format(incident=incident, lines="\n".join(evidence)))


def _steps(result: dict) -> list:
    return [(step["check"], step.get("args") or {}) for step in result.get("next") or []]


def _follow_up_fairly(leads, allowance, tools, evidence) -> bool:
    """Leads take turns, one follow-up per turn, until one is definitive or the
    allowance is spent. Returns True when a follow-up found the cause."""
    spent = 0
    while spent < allowance and any(queue for _, queue in leads):
        for _, queue in leads:
            if not queue or spent >= allowance:
                continue
            check, args = queue.pop(0)
            if check not in tools:
                evidence.append(f"{check}: skipped: no such check")
                continue
            spent += 1
            try:
                result = tools[check](**args) or {}
            except Exception:  # one worker's tool must not end the run
                evidence.append(f"{check}: failed")
                continue
            verdict = result.get("verdict", "clear")
            evidence.append(f"{check}: {verdict}: {result.get('finding', '')}")
            if verdict == "definitive":
                return True
            queue[0:0] = _steps(result)

    for label, queue in leads:
        if queue:
            evidence.append(f"{label}: {len(queue)} follow-ups not run")
    return False

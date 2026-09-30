"""What an unprepared learner writes in four minutes.

It counts the allowance and never spends past it, which feels like the whole
job. It serves the leads first come, first served: the first lead's queue is
drained before the second lead gets a call. When the first lead is a log
worker with forty requests to trace, the allowance is gone before the deploy
worker's one diff comes up. It also calls each follow-up bare, so one tool
that raises ends the investigation.
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
    spent = 0
    for label, queue in leads:
        while queue and spent < allowance:
            check, args = queue.pop(0)
            spent += 1
            result = tools[check](**args)
            evidence.append(f"{check}: {result['verdict']}: {result['finding']}")
            if result["verdict"] == "definitive":
                return True
            queue[0:0] = _steps(result)

    for label, queue in leads:
        if queue:
            evidence.append(f"{label}: {len(queue)} follow-ups not run")
    return False

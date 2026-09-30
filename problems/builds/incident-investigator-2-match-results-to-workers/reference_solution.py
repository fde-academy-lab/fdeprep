"""Reference solution for incident-investigator-2-match-results-to-workers.

In stage 1 a result came back from the call that asked for it, so pairing
was never written down. On workers that guarantee is gone. collect returns
results in the order workers finished, from a queue every investigation
shares, so neither position nor the check name says where a result came
from. The job id does, and nothing else in the result can.

The evidence walks the jobs this run dispatched, in dispatch order, and looks
each one up. That gives every job exactly one line, gives a result nobody
here asked for no line at all, and gives a worker that never reported a line
saying so.

Stage 1's rules survive unchanged: a definitive result ends the run, and a
lead's next checks are followed up front first.
"""

import json

RUNBOOK = ("deploys", "logs", "metrics")

FINDING = (
    "Incident {incident}. One line per check, in the order they were started:\n"
    "{lines}\n"
    "Write the finding for the on-call engineer in two sentences: the cause "
    "and the service it is on if a check found one, otherwise the strongest "
    "lead. Say which checks did not report.\n"
)


def run_agent(question: str, llm, tools: dict) -> str:
    alert = json.loads(question)
    incident = alert["incident"]

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

    evidence, follow_ups, definitive = [], [], False
    for job, check, service in jobs:
        result = by_job.get(job)
        if result is None:
            evidence.append(f"{check} {service}: no result")
            continue
        verdict = result.get("verdict", "clear")
        evidence.append(f"{check} {service}: {verdict}: {result.get('finding', '')}")
        if verdict == "definitive":
            definitive = True
        elif verdict == "lead":
            follow_ups += [(step["check"], step.get("args") or {})
                           for step in result.get("next") or []]

    if not definitive:
        _follow_up(follow_ups, tools, evidence)

    return llm(FINDING.format(incident=incident, lines="\n".join(evidence)))


def _follow_up(queue, tools, evidence):
    """Stage 1: run follow-ups front first, and stop on the first definitive one."""
    while queue:
        check, args = queue.pop(0)
        if check not in tools:
            evidence.append(f"{check}: skipped: no such check")
            continue
        result = tools[check](**args) or {}
        verdict = result.get("verdict", "clear")
        evidence.append(f"{check}: {verdict}: {result.get('finding', '')}")
        if verdict == "definitive":
            return True
        queue[0:0] = [(step["check"], step.get("args") or {})
                      for step in result.get("next") or []]
    return False

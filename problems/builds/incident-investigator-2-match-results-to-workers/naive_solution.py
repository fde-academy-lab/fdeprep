"""What an unprepared learner writes in four minutes.

It dispatches every job, collects the results, and pairs them with the jobs
in the order it dispatched them, which is exactly what stage 1's code did
without saying so. It worked there because each result came back from the
call that asked for it. Here the results come back in the order the workers
finished, from a queue other investigations share, so a finding lands on
whichever line happens to be next.
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

    jobs = []
    for service in alert["services"]:
        for check in RUNBOOK:
            tools["dispatch"](job=f"{incident}/{check}/{service}", check=check, service=service)
            jobs.append((check, service))

    results = tools["collect"]().get("results", [])

    evidence, follow_ups, definitive = [], [], False
    for (check, service), result in zip(jobs, results):
        evidence.append(f"{check} {service}: {result['verdict']}: {result['finding']}")
        if result["verdict"] == "definitive":
            definitive = True
        elif result["verdict"] == "lead":
            follow_ups += [(step["check"], step["args"]) for step in result.get("next", [])]

    if not definitive:
        _follow_up(follow_ups, tools, evidence)

    return llm(FINDING.format(incident=incident, lines="\n".join(evidence)))


def _follow_up(queue, tools, evidence):
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

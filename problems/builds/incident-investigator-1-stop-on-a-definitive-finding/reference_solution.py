"""Reference solution for incident-investigator-1-stop-on-a-definitive-finding.

The runbook is a queue. A check's follow-ups go on the front of it, because
they depend on what that check just found and should run while the lead is
fresh. The rest of the runbook waits behind them.

The loop stops on the first definitive verdict. Every check after the cause
costs minutes, and its evidence can only compete with the cause for the
model's attention: a database running hot because every request is retrying
is true, and it is a symptom.

The model is called once, with the lines of exactly the checks that ran.
"""

import json

RUNBOOK = ("deploys", "logs", "metrics")

FINDING = (
    "Incident {incident} on {service}. The checks that ran, in order:\n"
    "{lines}\n"
    "Write the finding for the on-call engineer in two sentences: the cause "
    "if a check found one, otherwise the strongest lead.\n"
)


def run_agent(question: str, llm, tools: dict) -> str:
    alert = json.loads(question)
    queue = [(check, {"service": alert["service"]}) for check in RUNBOOK]
    evidence = []

    while queue:
        check, args = queue.pop(0)
        if check not in tools:
            evidence.append(f"{check}: skipped: no such check")
            continue

        result = tools[check](**args) or {}
        verdict = result.get("verdict", "clear")
        evidence.append(f"{check}: {verdict}: {result.get('finding', '')}")

        if verdict == "definitive":
            break

        follow_ups = [(step["check"], step.get("args") or {})
                      for step in result.get("next") or []]
        queue[0:0] = follow_ups

    return llm(FINDING.format(incident=alert.get("incident"), service=alert.get("service"),
                              lines="\n".join(evidence)))

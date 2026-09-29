"""What an unprepared learner writes in four minutes.

It runs every check in the runbook, follows every lead by adding its next
checks to the end of the queue, and hands the model everything it found. The
run always finishes, so it looks correct. It never stops early, so a cause
found on the second check sits in the prompt next to whatever the later
checks turned up, and the model leads with the louder line.
"""

import json

RUNBOOK = ("deploys", "logs", "metrics")


def run_agent(question: str, llm, tools: dict) -> str:
    alert = json.loads(question)
    queue = [(check, {"service": alert["service"]}) for check in RUNBOOK]
    evidence = []

    while queue:
        check, args = queue.pop(0)
        result = tools[check](**args)
        evidence.append(f"{check}: {result['verdict']}: {result['finding']}")
        for step in result.get("next", []):
            queue.append((step["check"], step["args"]))

    return llm(
        "Evidence from the checks:\n" + "\n".join(evidence)
        + "\nWrite the finding for the on-call engineer."
    )

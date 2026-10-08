"""What an unprepared learner writes in four minutes.

It runs every case on both prompts the given number of times and counts the
passes, and it blocks the change when the candidate passed any case fewer
times than the prompt in production did. A provider error or an empty reply
counts as a failed trial, a case that was already flaky in production can
block, and one slip blocks a release with no second look. When the gateway
refuses a call, the refusal escapes; when the suite comes back without cases,
nothing is compared and the change ships. It never reports a case as flaky or
as having no data.
"""

import json
import re


def run_agent(question, llm, tools):
    suite = tools["suite"](change=question)
    verdicts, regressions = {}, []

    for case in suite.get("cases", []):
        passes = {}
        for side in ("baseline", "candidate"):
            passes[side] = 0
            for n in range(1, suite["trials"] + 1):
                reply = llm(f"{suite[side]['prompt']}\n\nCustomer: {case['input']}\nTrial: {n}")
                if re.search(case["expect"], reply):
                    passes[side] += 1
        if passes["candidate"] < passes["baseline"]:
            verdicts[case["id"]] = "regression"
            regressions.append(case["id"])
        elif passes["candidate"] > passes["baseline"]:
            verdicts[case["id"]] = "improved"
        else:
            verdicts[case["id"]] = "unchanged"

    decision = "block" if regressions else "ship"
    return json.dumps({"decision": decision, "cases": verdicts, "regressions": regressions,
                       "flaky": [], "no_data": []})

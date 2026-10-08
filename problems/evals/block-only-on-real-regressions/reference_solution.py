"""Reference solution for block-only-on-real-regressions.

A gate compares two distributions, and one trial of each prompt is one draw
from each. So every case runs several trials on the prompt in production and
on the change, and the gate compares what each prompt does reliably.

A trial that produced no answer is missing. An empty reply, an `Error:` reply
and a refused call say nothing about either prompt, and counting them as
failures blocks a release for an outage. A prompt with too few answers on a
case has no data on it, and no data asks for a rerun.

The live prompt's standing decides what a failure on the change means. A case
that already varied cannot convict the change, because its failures are what
that case does anyway. A case that always passed and now slips gets more
trials before anything is decided, and it is a regression only when the change
failed more than half of its answered trials. Those trials wait until every
case has had its main trials, so a short budget compares every case before it
pays for a second look at one.

When the gateway refuses a call it refuses every call after it, so the gate
stops asking. A run cut short decides rerun, never ship: the trials it never
asked could have convicted a case it would otherwise let through.
"""

import json
import re

TRIAL = "{prompt}\n\nCustomer: {input}\nTrial: {n}"


def standing(trials: list, need: int) -> str:
    answered = [t for t in trials if t != "missing"]
    if len(answered) < need:
        return "no_data"
    if "failed" not in answered:
        return "passes"
    return "fails" if "passed" not in answered else "mixed"


def run_agent(question: str, llm, tools: dict) -> str:
    suite = tools["suite"](change=question)
    cases = suite.get("cases") if isinstance(suite, dict) else None
    if not cases:
        return json.dumps({"decision": "rerun", "cases": {}, "regressions": [],
                           "flaky": [], "no_data": []})

    closed = False

    def trial(side: str, case: dict, n: int) -> str:
        nonlocal closed
        if closed:
            return "missing"
        try:
            reply = llm(TRIAL.format(prompt=suite[side]["prompt"], input=case["input"], n=n))
        except RuntimeError:  # the gateway's refusal; every later call would be refused too
            closed = True
            return "missing"
        if not reply.strip() or reply.strip().startswith("Error:"):
            return "missing"
        return "passed" if re.search(case["expect"], reply) else "failed"

    trials, need = suite["trials"], suite["min_answered"]
    runs = {}
    for case in cases:
        runs[case["id"]] = [[trial(side, case, n) for n in range(1, trials + 1)]
                            for side in ("baseline", "candidate")]

    verdicts = {}
    for case in cases:
        base, cand = runs[case["id"]]
        before, after = standing(base, need), standing(cand, need)
        if "no_data" in (before, after):
            verdict = "no_data"
        elif (before, after) == ("passes", "fails"):
            verdict = "regression"
        elif (before, after) == ("passes", "mixed"):
            cand += [trial("candidate", case, n)
                     for n in range(trials + 1, trials + suite["confirm"] + 1)]
            answered = [t for t in cand if t != "missing"]
            verdict = "regression" if 2 * answered.count("failed") > len(answered) else "flaky"
        elif "mixed" in (before, after):
            verdict = "flaky"
        elif (before, after) == ("fails", "passes"):
            verdict = "improved"
        else:
            verdict = "unchanged"
        verdicts[case["id"]] = verdict

    named = {v: [cid for cid, got in verdicts.items() if got == v]
             for v in ("regression", "flaky", "no_data")}
    if closed:
        decision = "rerun"
    elif named["regression"]:
        decision = "block"
    elif named["no_data"]:
        decision = "rerun"
    else:
        decision = "ship"
    return json.dumps({"decision": decision, "cases": verdicts,
                       "regressions": named["regression"], "flaky": named["flaky"],
                       "no_data": named["no_data"]})

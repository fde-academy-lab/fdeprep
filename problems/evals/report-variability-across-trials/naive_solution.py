"""What an unprepared learner writes in four minutes.

It runs every trial and counts the replies that matched, which is right, and
then calls the case a pass if any trial passed. A trial that produced no
answer is counted as a failure, so a night of provider errors reads as the
assistant getting every question wrong, and the pass rate is one number.
"""

import json
import re


def _norm(text: str) -> str:
    text = text.strip().lower()
    return text[:-1] if text.endswith(".") else text


def run_agent(question: str, llm, tools: dict) -> str:
    case = tools["case"](id=question) or {}
    trials = int(case.get("trials") or 0)
    expected = _norm(case.get("expected", ""))
    passed = failed = 0

    for _ in range(trials):
        reply = llm(case.get("question", ""))
        if _norm(reply) == expected:
            passed += 1
        else:
            failed += 1

    rate = passed / trials if trials else 0.0
    return json.dumps({
        "trials": trials, "passed": passed, "failed": failed, "missing": 0,
        "pass_rate": [rate, rate],
        "verdict": "pass" if passed else "fail",
    })

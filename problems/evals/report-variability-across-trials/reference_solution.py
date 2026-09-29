"""Reference solution for report-variability-across-trials.

Every trial runs, and each one lands in exactly one of three counts. A trial
that produced no answer is missing: it says something about the provider and
nothing about the assistant, so it widens the pass rate and leaves the
verdict alone.

The verdict describes the answered trials only. A case that passes some and
fails others is flaky, which is a finding in its own right and is never
rounded to a pass.
"""

import json
import re


def _normalise(text: str) -> str:
    text = text.strip().lower()
    return text[:-1] if text.endswith(".") else text


def _answered(reply) -> bool:
    text = str(reply or "").strip()
    return bool(text) and not text.startswith("Error:")


def _verdict(passed: int, failed: int) -> str:
    if passed + failed == 0:
        return "no_data"
    if failed == 0:
        return "pass"
    if passed == 0:
        return "fail"
    return "flaky"


def run_agent(question: str, llm, tools: dict) -> str:
    case = tools["case"](id=question) or {}
    trials = int(case.get("trials") or 0)
    expected = _normalise(case.get("expected", ""))
    passed = failed = missing = 0

    for _ in range(trials):
        reply = llm(case.get("question", ""))
        if not _answered(reply):
            missing += 1
        elif _normalise(reply) == expected:
            passed += 1
        else:
            failed += 1

    # With no trials at all the rate could be anything, so the range says so.
    low, high = (passed / trials, (passed + missing) / trials) if trials else (0.0, 1.0)
    return json.dumps({
        "trials": trials, "passed": passed, "failed": failed, "missing": missing,
        "pass_rate": [low, high],
        "verdict": _verdict(passed, failed),
    })

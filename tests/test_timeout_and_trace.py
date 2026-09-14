"""Acceptance 6 and 7: the watchdog, and trace truncation."""

import json

from runner.battery.execute import run_battery
from runner.harness.trace import TRACE_LIMIT_BYTES, truncate

INFINITE = """
def run_agent(question, llm, tools):
    while True:
        pass
"""

RAISES = """
def run_agent(question, llm, tools):
    raise ValueError("boom")
"""

RETURNS_NON_STRING = """
def run_agent(question, llm, tools):
    return {"not": "a string"}
"""


def test_infinite_loop_returns_timeout_rather_than_crashing(problem):
    result = run_battery(problem, INFINITE)
    assert result["verdict"] == "timeout"
    public = result["gates"]["public"]
    assert public["status"] == "fail"
    assert any("timeout" in (c["message"] or "").lower() for c in public["cases"]), public["cases"]


def test_an_exception_in_learner_code_is_a_failed_case_not_a_crash(problem):
    result = run_battery(problem, RAISES)
    assert result["verdict"] == "fail"
    messages = " ".join((c["message"] or "") for c in result["gates"]["public"]["cases"])
    assert "ValueError" in messages


def test_a_non_string_return_fails_returns_nonempty(problem):
    result = run_battery(problem, RETURNS_NON_STRING)
    assert result["gates"]["public"]["status"] == "fail"


def test_a_trace_over_256kb_truncates_with_a_marker():
    steps = [
        {"seq": i, "type": "llm_call", "prompt": "x" * 4000, "prompt_chars": 4000,
         "response": "y" * 400, "ms": 0}
        for i in range(1, 400)
    ]
    trace = truncate({"submission_id": 1, "steps": steps, "flags": [], "truncated": False})

    assert trace["truncated"] is True
    assert len(json.dumps(trace).encode()) <= TRACE_LIMIT_BYTES
    markers = [s for s in trace["steps"] if s["type"] == "truncation_marker"]
    assert len(markers) == 1
    assert trace["steps"].index(markers[0]) == 40
    assert len(trace["steps"]) == 81
    assert markers[0]["omitted"] == len(steps) - 80


def test_a_small_trace_is_left_alone():
    trace = {"submission_id": 1, "steps": [{"seq": 1, "type": "final", "value": "ok"}],
             "flags": [], "truncated": False}
    assert truncate(dict(trace)) == trace

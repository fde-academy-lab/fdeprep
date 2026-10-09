"""docs/00 section 4 and docs/01 S4: a Run executes the public tests only, and a
Submit runs public, hidden and adversarial under the per-tier caps.

Found on 8 October 2026. The worker built the runner's event without the
submission kind and the handler never read one, so every Run executed the
public, hidden and adversarial cases and reported pass only when all three
passed. At the Run allowance of 30 an hour that told a learner whether the
hidden battery passed, which turned Run into an oracle for unpublished cases
and stepped round the Extreme tier's one submit a day.

The worked problem's naive solution passes both public cases and fails a
hidden one, so it is the solution a Run must report on without giving the
hidden result away. A Run still runs the static gate first (docs/03 section
4.1) and still checks every step, on the public cases and on a step's own
case (docs/00 section 3.2, docs/03 section 5).
"""

from __future__ import annotations

import json

import pytest

from runner import handler
from runner.battery import execute
from runner.battery.execute import run_battery, run_single_case

NOTHING = {"status": "skipped", "passed": 0, "total": 0, "cases": []}


def _names(problem, visibility):
    return {c.name for c in problem.cases(visibility)}


def _questions(problem, visibility):
    return {c.spec["input"]["question"] for c in problem.cases(visibility)}


@pytest.fixture
def staged(monkeypatch):
    """Every case the battery hands to a sandbox, the stub baseline's included."""
    seen: list[tuple[str, dict]] = []
    real = execute.run_single_case

    def recording(name, spec, source, **kwargs):
        seen.append((name, dict(spec.get("input") or {})))
        return real(name, spec, source, **kwargs)

    monkeypatch.setattr(execute, "run_single_case", recording)
    # The stub baseline is cached per process. Cleared so this run stages the
    # stub's cases too and the recording sees every case a Run executes.
    monkeypatch.setattr(execute, "_BASELINES", {})
    return seen


def test_a_run_never_stages_a_hidden_or_adversarial_case(problem, naive_source, staged):
    run_battery(problem, naive_source, kind="run")

    names = {name for name, _ in staged}
    inputs = {json.dumps(payload, sort_keys=True) for _, payload in staged}
    unpublished = _names(problem, "hidden") | _names(problem, "adversarial")
    assert names, "a Run executes something"
    assert not names & unpublished, names & unpublished
    for question in _questions(problem, "hidden") | _questions(problem, "adversarial"):
        assert not any(question in staged_input for staged_input in inputs), question
    # What it did run: the public cases and the steps' own cases.
    assert _names(problem, "public") <= names
    assert any(name.startswith("step ") for name in names)


def test_a_run_reports_the_public_result_and_nothing_about_hidden(problem, naive_source):
    submitted = run_battery(problem, naive_source, already_passed=True)
    assert submitted["gates"]["public"]["status"] == "pass"
    assert submitted["gates"]["hidden"]["status"] == "fail", "the fixture this test rests on"

    result = handler.lambda_handler({"problem": problem.raw, "solution": naive_source,
                                     "kind": "run"})

    assert result["verdict"] == "pass"
    assert result["score"] is None
    assert result["gates"]["static"]["status"] == "pass"
    assert result["gates"]["public"]["status"] == "pass"
    assert {c["name"] for c in result["gates"]["public"]["cases"]} == _names(problem, "public")
    assert result["gates"]["hidden"] == NOTHING
    assert result["gates"]["adversarial"] == NOTHING

    # No count, name, message, input or trace of an unpublished case anywhere
    # in what comes back, including the trace the worker stores.
    text = json.dumps(result)
    unpublished = _names(problem, "hidden") | _names(problem, "adversarial")
    for name in unpublished:
        assert name not in text, name
    for question in _questions(problem, "hidden") | _questions(problem, "adversarial"):
        assert question not in text, question
    for case in submitted["gates"]["hidden"]["cases"]:
        if case["message"]:
            assert case["message"] not in text, case["message"]
    assert {c["name"] for c in result["trace"]["cases"]} == _names(problem, "public")


def test_a_runs_budget_counts_the_public_cases_only(problem, naive_source):
    result = run_battery(problem, naive_source, kind="run")
    public = [
        run_single_case(c.name, c.spec, naive_source, allowed_imports=problem.allowed_imports,
                        time_limit_s=problem.time_limit_s)
        for c in problem.cases("public")
    ]
    assert result["budget"]["llm_calls"] == max(c["llm_calls"] for c in public)
    assert result["budget"]["tool_calls"] == max(c["tool_calls"] for c in public)


def test_a_run_still_checks_every_step(problem, reference_source, naive_source):
    reference = run_battery(problem, reference_source, kind="run")
    assert [s["status"] for s in reference["steps"]] == ["pass"] * len(problem.step_checks)
    # Steps read public cases and their own cases only, so a Run and a Submit
    # of the same code agree on every one of them.
    assert (run_battery(problem, naive_source, kind="run")["steps"]
            == run_battery(problem, naive_source, kind="submit")["steps"])


def test_a_run_that_fails_a_public_case_still_withholds_the_hidden_count(problem):
    stub = problem.raw["stub_code"]
    submitted = run_battery(problem, stub)
    assert submitted["gates"]["public"]["status"] == "fail"
    assert submitted["gates"]["hidden"]["total"] == len(problem.cases("hidden"))

    result = run_battery(problem, stub, kind="run")
    assert result["verdict"] == "fail"
    assert result["gates"]["hidden"] == NOTHING
    assert result["gates"]["adversarial"] == NOTHING
    assert result["score"] is None


def test_a_run_the_static_gate_rejects_is_rejected_and_unscored(problem):
    result = run_battery(problem, "import socket\ndef run_agent(q, llm, t): return 'x'",
                         kind="run")
    assert result["verdict"] == "rejected"
    assert result["gates"]["public"]["status"] == "skipped"
    assert result["gates"]["hidden"] == NOTHING
    assert result["score"] is None
    assert result["steps"] == []


def test_a_run_never_claims_a_competency_pass(problem, reference_source):
    result = run_battery(problem, reference_source, kind="run")
    assert result["verdict"] == "pass"
    assert {d["state"] for d in result["competency_deltas"]} == {"attempted"}


@pytest.mark.parametrize("kind", ["submit", "rehearsal_submit"])
def test_a_submit_runs_the_full_battery(problem, naive_source, reference_source, kind):
    naive = handler.lambda_handler({"problem": problem.raw, "solution": naive_source,
                                    "kind": kind})
    assert naive["verdict"] == "fail"
    assert naive["gates"]["hidden"]["status"] == "fail"
    assert naive["gates"]["hidden"]["total"] == len(problem.cases("hidden"))
    assert naive["score"] is not None

    reference = handler.lambda_handler({"problem": problem.raw, "solution": reference_source,
                                        "kind": kind})
    assert reference["verdict"] == "pass"
    assert reference["gates"]["adversarial"]["status"] == "pass"
    assert reference["score"] == 100


def test_an_event_without_a_kind_runs_the_full_battery(problem, naive_source):
    """The event docs/03 defined before 8 October 2026 carried no kind, and the
    handler graded every one of them with the full battery. An older worker
    still sends that event for one release, and it gets what it always got,
    which is also what a Submit gets."""
    legacy = handler.lambda_handler({"problem": problem.raw, "solution": naive_source})
    submitted = handler.lambda_handler({"problem": problem.raw, "solution": naive_source,
                                        "kind": "submit"})
    assert legacy["verdict"] == submitted["verdict"] == "fail"
    assert legacy["gates"] == submitted["gates"]
    assert legacy["score"] == submitted["score"]


@pytest.mark.parametrize("kind", ["defence", "live", "Run", "", None, 1, ["run"]])
def test_a_kind_the_runner_does_not_grade_is_an_error_that_costs_nothing(problem, kind,
                                                                         naive_source):
    result = handler.lambda_handler({"problem": problem.raw, "solution": naive_source,
                                     "kind": kind})
    assert result["verdict"] == "error"
    assert result["consumes_allowance"] is False
    assert "gates" not in result


def test_the_battery_refuses_a_kind_it_does_not_know(problem, naive_source):
    with pytest.raises(ValueError):
        run_battery(problem, naive_source, kind="live")


def test_runner_local_runs_a_kind(naive_source, tmp_path, capsys):
    from runner.local import main
    from tests.conftest import PROBLEM

    solution = tmp_path / "solution.py"
    solution.write_text(naive_source)
    path = str(PROBLEM)

    assert main([path, str(solution), "--kind", "run", "--json"]) == 0
    ran = json.loads(capsys.readouterr().out)
    assert ran["verdict"] == "pass"
    assert ran["gates"]["hidden"] == NOTHING

    assert main([path, str(solution), "--kind", "submit", "--json"]) == 1
    assert json.loads(capsys.readouterr().out)["gates"]["hidden"]["status"] == "fail"

"""docs/03 section 9.1: hidden means unpublished, not unreadable.

The sandbox may see inputs. It must never see an expected output, and it must
never be handed the whole hidden suite at once.
"""

import json

from runner.battery.execute import run_battery


def _expected_strings(problem):
    """Expected values distinctive enough that finding one proves a leak.

    Numeric limits are excluded on purpose. A budget of 6 also appears in the
    learner's own range(6), so searching for "6" proves nothing either way. The
    regexes and exact strings are the ones only the evaluator should hold.
    """
    out = []
    for case in problem.tests:
        for assertion in case.spec.get("assertions", []):
            for key in ("value", "schema"):
                value = assertion.get(key)
                if isinstance(value, str) and len(value) > 2:
                    out.append((case.name, assertion["type"], key, value))
    return out


def test_the_working_directory_holds_the_learner_source_and_nothing_else(problem,
                                                                          reference_source):
    """The strongest form of 9.1: the runner stages none of its own bytes."""
    staged = []

    def observer(case_name, staged_dir, payload):
        files = {
            str(p.relative_to(staged_dir)): p.read_text(errors="replace")
            for p in staged_dir.rglob("*") if p.is_file()
        }
        staged.append((case_name, files))

    run_battery(problem, reference_source, stage_observer=observer)
    assert staged, "no case was staged, so this test proved nothing"

    for case_name, files in staged:
        assert set(files) == {"solution.py"}, (
            f"{case_name} staged more than the solution: {sorted(files)}"
        )
        assert files["solution.py"] == reference_source, (
            f"{case_name} staged a solution.py that is not byte-identical to the submission"
        )


def test_no_expected_output_reaches_the_sandbox(problem, reference_source):
    payloads = []
    run_battery(
        problem, reference_source,
        stage_observer=lambda name, d, payload: payloads.append((name, payload)),
    )
    assert payloads
    expected = _expected_strings(problem)
    assert expected, "this test needs at least one string expectation to mean anything"

    blob = json.dumps([p for _, p in payloads], sort_keys=True)
    for case_name, kind, key, value in expected:
        assert value not in blob, (
            f"the {kind}.{key} expectation from {case_name} reached the sandbox payload"
        )


def test_assertions_never_reach_the_sandbox_payload(problem, reference_source):
    payloads = []
    run_battery(
        problem,
        reference_source,
        stage_observer=lambda name, d, payload: payloads.append((name, payload)),
    )
    assert payloads

    for case_name, payload in payloads:
        assert "assertions" not in payload, f"{case_name} payload carried assertions"
        blob = json.dumps(payload, sort_keys=True)
        assert "returns_matches" not in blob
        assert "ignores_injection" not in blob


def test_one_case_is_staged_per_invocation(problem, reference_source):
    payloads = []
    run_battery(
        problem,
        reference_source,
        stage_observer=lambda name, d, payload: payloads.append(payload),
    )
    for payload in payloads:
        assert isinstance(payload["input"], dict)
        assert "cases" not in payload
        assert "tests" not in payload
    names = [p["case_name"] for p in payloads]
    assert len(names) == len(set(names)), "a case was staged more than once"


def test_the_full_hidden_suite_is_never_in_one_payload(problem, reference_source):
    hidden = [c.name for c in problem.tests if c.visibility == "hidden"]
    assert len(hidden) >= 2, "this test needs at least two hidden cases to mean anything"

    payloads = []
    run_battery(
        problem,
        reference_source,
        stage_observer=lambda name, d, payload: payloads.append(payload),
    )
    for payload in payloads:
        blob = json.dumps(payload, sort_keys=True)
        present = [h for h in hidden if h in blob]
        assert len(present) <= 1, f"payload mentioned several hidden cases: {present}"

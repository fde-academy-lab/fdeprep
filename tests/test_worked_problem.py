"""Acceptance 1 and 2: the worked Medium problem, both solutions."""

from runner.battery.execute import run_battery


def test_reference_solution_passes_every_gate(problem, reference_source):
    result = run_battery(problem, reference_source)
    gates = result["gates"]
    assert gates["static"]["status"] == "pass"
    assert gates["public"]["status"] == "pass", gates["public"]["cases"]
    assert gates["hidden"]["status"] == "pass", gates["hidden"]["cases"]
    assert gates["adversarial"]["status"] == "pass", gates["adversarial"]["cases"]
    assert result["verdict"] == "pass"
    assert result["score"] == 100


def test_naive_solution_passes_public_and_fails_a_hidden_test(problem, naive_source):
    result = run_battery(problem, naive_source)
    gates = result["gates"]
    assert gates["static"]["status"] == "pass"
    assert gates["public"]["status"] == "pass", gates["public"]["cases"]
    assert gates["hidden"]["status"] == "fail"
    assert gates["hidden"]["passed"] < gates["hidden"]["total"]
    assert result["verdict"] == "fail"


def test_adversarial_is_skipped_when_hidden_fails(problem, naive_source):
    gates = run_battery(problem, naive_source)["gates"]
    assert gates["adversarial"]["status"] == "skipped"
    assert gates["adversarial"]["passed"] == 0


def test_a_gate_that_never_ran_is_skipped_never_fail(problem):
    gates = run_battery(problem, "import socket\ndef run_agent(q, llm, t): return 'x'")["gates"]
    assert gates["static"]["status"] == "fail"
    for name in ("public", "hidden", "adversarial"):
        assert gates[name]["status"] == "skipped", name


def test_hidden_cases_are_empty_until_the_learner_has_passed(problem, naive_source):
    gates = run_battery(problem, naive_source)["gates"]
    assert gates["hidden"]["cases"] == []
    assert gates["public"]["cases"], "public cases are always shown"


def test_hidden_cases_are_shown_once_the_problem_is_passed(problem, naive_source):
    gates = run_battery(problem, naive_source, already_passed=True)["gates"]
    assert gates["hidden"]["cases"], "a learner who has passed sees the hidden cases"


def test_result_carries_the_full_contract(problem, reference_source):
    result = run_battery(problem, reference_source, image_tag="runner:test")
    for key in ("verdict", "score", "gates", "budget", "trace_ref",
                "competency_deltas", "runner"):
        assert key in result, key
    assert set(result["gates"]) == {"static", "public", "hidden", "adversarial"}
    assert result["runner"]["image_tag"] == "runner:test"
    assert isinstance(result["runner"]["duration_ms"], int)
    budget = result["budget"]
    assert budget["max_llm_calls"] == problem.call_budget
    assert isinstance(budget["within_budget"], bool)


def test_injection_reaches_the_naive_loop_but_not_the_reference(problem, naive_source,
                                                               reference_source):
    """The adversarial case is the point of the problem, so prove both directions."""
    from tests.support import run_named_case

    naive = run_named_case(problem, naive_source, "adversarial_injection_in_observation")
    reference = run_named_case(problem, reference_source, "adversarial_injection_in_observation")
    assert naive["status"] == "fail", "a loop that pastes raw tool output should emit the canary"
    assert reference["status"] == "pass", reference

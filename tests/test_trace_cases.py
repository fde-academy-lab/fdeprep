"""Each case in a submission's trace says which battery it ran in and how it ended.

docs/01 S7 and docs/03 section 5, as decided on 8 October 2026: a learner's
replay shows the public cases in full and each hidden or adversarial case as
an anonymous row in the place it ran, saying how it ended, and faculty read
every case in full. The replay builder needs both facts for every case, and
the stored result cannot give them: it leaves hidden and adversarial names out
until the learner has passed. The runner is the one component that knows them,
so it writes them beside each case's trace, which stays whole for faculty and
for an appeal.
"""

from __future__ import annotations

from runner.battery.execute import run_battery

ORDER = ("public", "hidden", "adversarial")


def _cases(result):
    return result["trace"]["cases"]


def test_every_case_names_its_battery_and_outcome_in_the_order_it_ran(problem, reference_source):
    result = run_battery(problem, reference_source)
    cases = _cases(result)

    expected = [(c.name, battery) for battery in ORDER for c in problem.cases(battery)]
    assert [(c["name"], c["battery"]) for c in cases] == expected
    assert {c["status"] for c in cases} == {"pass"}


def test_a_failed_case_reads_failed_and_its_battery_counts_agree(problem, naive_source):
    result = run_battery(problem, naive_source)
    hidden = [c for c in _cases(result) if c["battery"] == "hidden"]

    assert result["gates"]["hidden"]["status"] == "fail", "the fixture this test rests on"
    assert [c["name"] for c in hidden] == [c.name for c in problem.cases("hidden")]
    assert sum(c["status"] == "pass" for c in hidden) == result["gates"]["hidden"]["passed"]
    assert any(c["status"] == "fail" for c in hidden)
    # The adversarial battery runs only once the hidden one passes.
    assert all(c["battery"] != "adversarial" for c in _cases(result))


def test_a_run_traces_its_public_cases_and_says_so(problem, naive_source):
    cases = _cases(run_battery(problem, naive_source, kind="run"))
    assert {c["battery"] for c in cases} == {"public"}
    assert [c["name"] for c in cases] == [c.name for c in problem.cases("public")]

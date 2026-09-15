"""The launch set, checked the way docs/04 section 6 says to check it.

Every code problem in problems/ runs both of its solutions through the real
battery. The reference has to pass every gate and the naive has to pass public
and fail a hidden test, because a naive solution that passes everything means
the problem teaches nothing.

The call budget is checked too. docs/04 item 5 says one above a clean solution
and at least two below a naive one, and only the first half is enforceable:
whether a naive solution is wasteful depends on what its characteristic mistake
is, and several of these fail by crashing or by answering wrongly rather than
by spending. The naive figure is reported by tools/budget_report.py rather than
asserted.
"""

from __future__ import annotations

import collections
import copy
import pathlib

import pytest
import yaml

from runner.battery.execute import run_battery
from runner.battery.static_gate import check as static_check
from runner.problem import from_dict, load_problem

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROBLEMS = ROOT / "problems"

# docs/00 section 9.
EXPECTED_MIX = {
    ("easy", "code"): 6, ("easy", "prompt"): 2,
    ("medium", "code"): 5, ("medium", "prompt"): 2, ("medium", "design"): 1,
    ("hard", "code"): 4, ("hard", "prompt"): 1, ("hard", "design"): 1,
    ("extreme", "code"): 2, ("extreme", "design"): 1,
}

# Lifted ceiling for measuring what a solution wants rather than what it was
# allowed. Well above any budget in the set.
GENEROUS = 40

# docs/04 section 3 reproduces this problem verbatim, so the file matches the
# specification rather than the checklist the same document sets out four
# sections later. Its clean path costs two calls against a budget of six.
# Editing it would put problems/ in conflict with docs/04; the disagreement is
# reported in the pull request instead.
BUDGET_EXEMPT = {"recover-from-soft-tool-errors"}


def launch_files() -> list[pathlib.Path]:
    return sorted(p for p in PROBLEMS.rglob("*.yaml") if "_fixtures" not in p.parts)


def parsed() -> list[dict]:
    return [yaml.safe_load(p.read_text()) for p in launch_files()]


def code_problems() -> list[pathlib.Path]:
    return [p for p in launch_files() if yaml.safe_load(p.read_text())["artefact_type"] == "code"]


CODE = code_problems()
IDS = [p.stem for p in CODE]


def solutions(path: pathlib.Path) -> tuple[str, str]:
    folder = path.with_suffix("")
    return ((folder / "reference_solution.py").read_text(),
            (folder / "naive_solution.py").read_text())


def unbounded(problem):
    raw = copy.deepcopy(problem.raw)
    raw["call_budget"] = GENEROUS
    for test in raw.get("tests", []):
        budget = test.setdefault("spec", {}).setdefault("budget", {})
        budget["max_llm_calls"] = GENEROUS
        budget["max_tool_calls"] = GENEROUS * 2
        test["spec"]["assertions"] = [
            a for a in (test["spec"].get("assertions") or [])
            if a.get("type") not in ("llm_calls_at_most", "tool_calls_at_most")
        ]
    return from_dict(raw)


def clean_demand(problem, source: str) -> int:
    """Model calls a clean solution wants, with every ceiling lifted.

    A case where the reference spends the whole authored allowance has no
    terminating path for a correct solution, so it measures the ceiling rather
    than the solution and is left out.
    """
    result = run_battery(unbounded(problem), source)
    counts = [
        sum(1 for s in (case["trace"].get("steps") or []) if s.get("type") == "llm_call")
        for case in result["trace"]["cases"]
    ]
    inside = [c for c in counts if c < problem.call_budget]
    return max(inside, default=0)


def test_the_launch_set_matches_the_prd_table():
    mix = collections.Counter((p["difficulty"], p["artefact_type"]) for p in parsed())
    assert dict(mix) == EXPECTED_MIX
    assert sum(mix.values()) == 25


def test_every_slug_is_unique():
    slugs = [p["slug"] for p in parsed()]
    assert len(slugs) == len(set(slugs))


def test_every_track_is_represented():
    tracks = collections.Counter(p["track"] for p in parsed())
    assert set(tracks) == {"agent-loop", "tool-creation", "memory", "rag", "evals", "prompt"}


def test_hard_and_extreme_code_problems_carry_a_defence_question():
    for problem in parsed():
        if problem["artefact_type"] == "code" and problem["difficulty"] in ("hard", "extreme"):
            assert problem.get("defence_question", "").strip(), problem["slug"]


def test_extreme_problems_carry_no_hints():
    for problem in parsed():
        if problem["difficulty"] == "extreme":
            assert not problem.get("hints"), problem["slug"]


@pytest.mark.parametrize("path", CODE, ids=IDS)
def test_the_reference_solution_passes_every_gate(path):
    problem = load_problem(path)
    reference, _ = solutions(path)
    result = run_battery(problem, reference)

    for gate in ("static", "public", "hidden", "adversarial"):
        status = result["gates"][gate]["status"]
        assert status in ("pass", "skipped"), (gate, result["gates"][gate])
    assert result["verdict"] == "pass"


@pytest.mark.parametrize("path", CODE, ids=IDS)
def test_the_naive_solution_passes_public_and_fails_a_hidden_test(path):
    problem = load_problem(path)
    _, naive = solutions(path)
    result = run_battery(problem, naive)

    assert result["gates"]["static"]["status"] == "pass"
    assert result["gates"]["public"]["status"] == "pass", [
        c for c in result["gates"]["public"]["cases"] if c["status"] == "fail"
    ]
    assert result["gates"]["hidden"]["status"] == "fail"
    assert result["verdict"] == "fail"


@pytest.mark.parametrize("path", CODE, ids=IDS)
def test_the_budget_is_one_above_a_clean_solution(path):
    problem = load_problem(path)
    if problem.slug in BUDGET_EXEMPT:
        pytest.skip("docs/04 section 3 reproduces this problem verbatim; see the module docstring")
    reference, _ = solutions(path)
    clean = clean_demand(problem, reference)
    assert problem.call_budget == clean + 1, (
        f"{problem.slug}: a clean solution wants {clean} calls and the budget is "
        f"{problem.call_budget}"
    )


@pytest.mark.parametrize("path", CODE, ids=IDS)
def test_neither_solution_trips_the_private_attribute_rule(path):
    """A gate that rejects correct code is worse than the hole it closed.

    Both solutions of every launch problem go through the static gate, so the
    rule added for llm._script has to leave seventeen working loops alone.
    """
    problem = load_problem(path)
    for label, source in zip(("reference", "naive"), solutions(path)):
        outcome = static_check(source, problem.allowed_imports)
        assert outcome.status == "pass", (path.stem, label, outcome.reasons)

"""The assertion types added on 29 and 30 September 2026, run end to end.

CLAUDE.md asks for a fixture with every new assertion type, so an author has
a spec known to work and a change to the runner cannot quietly break one.
problems/_fixtures/check-what-reaches-the-model.yaml uses returns_lacks,
calls_tool_with, prompt_contains and prompt_lacks in every case. Each case
runs here through the sandbox against a solution that passes all four, and
against one solution aimed at each assertion.
"""

from __future__ import annotations

import pathlib

import pytest

from runner.battery.execute import run_single_case
from runner.problem import load_problem

FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "problems/_fixtures/check-what-reaches-the-model.yaml"

PASSES = """
import re

def run_agent(question, llm, tools):
    found = tools["lookup"](account=re.search(r"A-\\d+", question).group(0))
    return llm(f"Order status: {found['status']}. Tell the customer.")
"""

AIMED = {
    "calls_tool_with": """
def run_agent(question, llm, tools):
    found = tools["lookup"](account=question)
    return llm(f"Order status: {found['status']}. Tell the customer.")
""",
    "prompt_contains": """
import re

def run_agent(question, llm, tools):
    tools["lookup"](account=re.search(r"A-\\d+", question).group(0))
    return llm("Tell the customer about their order.")
""",
    "prompt_lacks": """
import re

def run_agent(question, llm, tools):
    found = tools["lookup"](account=re.search(r"A-\\d+", question).group(0))
    return llm(f"Order status: {found['status']}. Customer: {found['email']}.")
""",
    "returns_lacks": """
import re

def run_agent(question, llm, tools):
    found = tools["lookup"](account=re.search(r"A-\\d+", question).group(0))
    reply = llm(f"Order status: {found['status']}. Tell the customer.")
    return f"{reply} A copy went to {found['email']}."
""",
}

PROBLEM = load_problem(FIXTURE)
CASES = [case for case in PROBLEM.tests]


def _outcomes(case, source):
    result = run_single_case(case.name, case.spec, source, allowed_imports=PROBLEM.allowed_imports,
                             time_limit_s=PROBLEM.time_limit_s)
    return {a["type"]: a for a in result["assertions"]}


def test_the_fixture_uses_every_assertion_type_it_stands_for():
    for case in CASES:
        assert {a["type"] for a in case.spec["assertions"]} == set(AIMED), case.name


@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
def test_a_solution_that_keeps_every_promise_passes_every_assertion(case):
    outcomes = _outcomes(case, PASSES)
    assert all(a["status"] == "pass" for a in outcomes.values()), outcomes


@pytest.mark.parametrize("aimed", sorted(AIMED))
@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
def test_each_assertion_fails_the_solution_aimed_at_it(case, aimed):
    outcome = _outcomes(case, AIMED[aimed])[aimed]
    assert outcome["status"] == "fail"
    assert outcome["message"], "a failing assertion says why"

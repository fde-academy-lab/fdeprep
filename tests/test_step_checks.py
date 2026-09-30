"""docs/00 section 3.2 L3 and docs/01 S4: each step has its own micro-check,
which runs on every Run and turns green independently, so progress is visible
before the whole battery passes.

The spec never said which case a check reads. Measured across the 43 problems
that carry checks on 29 September 2026: read against every public case, 16
reference solutions leave a step red; read against any public case, all 43
turn every step green. Authors wrote them against the second reading, so that
is the rule. Only public cases count, so a step never reports on a case the
learner cannot see.

A check the untouched stub already satisfies cannot tell a learner's work
from no work: on 30 September 2026, 76 of the catalogue's 160 steps read
green on the stub. The runner runs the stub against the same public cases,
once per problem version, and reports such a step as unchecked rather than
green.
"""

from __future__ import annotations

from runner.battery.execute import run_battery
from runner.problem import from_dict

ANSWERS = [{"match": "*", "reply": "Final Answer: in transit"}]
ACTS = [
    {"match": {"call_index": 1}, "reply": "Action: track(id=7)"},
    {"match": "*", "reply": "Final Answer: in transit"},
]


def _case(name, visibility, script, assertions):
    return {
        "name": name, "visibility": visibility,
        "spec": {
            "kind": "agent_run", "input": {"question": f"where is order {name}"},
            "llm_script": script, "tools": {"track": {"returns": {"state": "in_transit"}}},
            "budget": {"max_llm_calls": 4, "max_tool_calls": 4, "wall_ms": 5000},
            "assertions": assertions,
        },
    }


PROBLEM = from_dict({
    "slug": "stepped", "artefact_type": "code", "difficulty": "easy", "call_budget": 4,
    "tests": [
        _case("p1", "public", ANSWERS, [{"type": "returns_nonempty"}]),
        _case("p2", "public", ACTS, [{"type": "calls_tool", "name": "track"}]),
        _case("h1", "hidden", ACTS, [{"type": "returns_nonempty"}]),
        _case("h2", "hidden", ACTS, [{"type": "returns_nonempty"}]),
    ],
    "step_checks": [
        {"step_id": "s1", "spec": {"assertions": [{"type": "returns_nonempty"}]}},
        {"step_id": "s2", "spec": {"assertions": [{"type": "calls_tool", "name": "track"}]}},
        {"step_id": "s3", "spec": {"assertions": [{"type": "returns_matches", "value": "transit"}]}},
    ],
})

# Answers with the model's text and never acts: steps 1 and 3 hold on p1, and
# step 2 holds nowhere.
ANSWERS_ONLY = """
def run_agent(question, llm, tools):
    reply = llm(question)
    return reply.split("Final Answer:", 1)[-1].strip()
"""

# Acts when told to, then answers: step 2 holds on p2 only, which is enough.
LOOP = """
def run_agent(question, llm, tools):
    prompt = question
    for _ in range(3):
        reply = llm(prompt)
        if reply.startswith("Action:"):
            prompt += "\\n" + str(tools["track"](id=7))
            continue
        return reply.split("Final Answer:", 1)[-1].strip()
    return ""
"""


def _steps(result):
    return {step["id"]: step["status"] for step in result["steps"]}


def test_a_step_turns_green_when_any_public_case_satisfies_it():
    assert _steps(run_battery(PROBLEM, LOOP)) == {"s1": "pass", "s2": "pass", "s3": "pass"}


def test_each_step_turns_green_on_its_own_before_the_battery_passes():
    result = run_battery(PROBLEM, ANSWERS_ONLY)
    assert result["gates"]["public"]["status"] == "fail"
    assert _steps(result) == {"s1": "pass", "s2": "fail", "s3": "pass"}


def test_the_steps_come_back_in_the_order_the_problem_lists_them():
    assert [s["id"] for s in run_battery(PROBLEM, LOOP)["steps"]] == ["s1", "s2", "s3"]


def test_a_hidden_case_never_turns_a_step_green():
    """ANSWERS_ONLY calls no tool on any public case. The hidden cases would not
    change that, and they must not be run for a step's sake either."""
    result = run_battery(PROBLEM, ANSWERS_ONLY)
    assert _steps(result)["s2"] == "fail"
    assert result["gates"]["hidden"]["status"] == "skipped"


def test_code_the_gate_rejects_reports_no_steps():
    result = run_battery(PROBLEM, "import os\ndef run_agent(question, llm, tools):\n    return 'x'\n")
    assert result["gates"]["static"]["status"] == "fail"
    assert result["steps"] == []


def test_a_problem_without_steps_reports_an_empty_list():
    plain = from_dict({**PROBLEM.raw, "step_checks": []})
    assert run_battery(plain, LOOP)["steps"] == []


# The stub answers from the model's text, as ANSWERS_ONLY does, so steps 1
# and 3 are ones the public cases cannot tell apart from no work at all.
STUBBED = from_dict({**PROBLEM.raw, "stub_code": ANSWERS_ONLY})


def test_a_step_the_stub_already_satisfies_is_unchecked_rather_than_green():
    assert _steps(run_battery(STUBBED, LOOP)) == {
        "s1": "unchecked", "s2": "pass", "s3": "unchecked"}


def test_the_stub_itself_never_turns_a_step_green():
    assert "pass" not in _steps(run_battery(STUBBED, ANSWERS_ONLY)).values()


def test_a_step_the_learner_breaks_is_red_whatever_the_stub_does():
    silent = "def run_agent(question, llm, tools):\n    return ''\n"
    assert _steps(run_battery(STUBBED, silent)) == {"s1": "fail", "s2": "fail", "s3": "fail"}


def test_no_case_result_carries_the_step_detail():
    """The contract's case entries stay as they were; steps have their own key."""
    result = run_battery(PROBLEM, ANSWERS_ONLY)
    for case in result["gates"]["public"]["cases"]:
        assert not any(key.startswith("_") or key == "steps" for key in case)

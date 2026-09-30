"""Tool specs an author writes in YAML, beyond a fixed value and a named fixture.

A `returns` tool gave every call the same value, whatever it was asked and
however often, so a problem could not have a tool that fails and then
recovers, or a store that answers by key. Authors worked around both: one
recovery case asked a second tool, and the retried-webhook problem could only
catch the wrong key through the claim's own arguments. `sequence` gives each
call its own value and `by_arg` answers by one argument. Added 30 September
2026.
"""

from __future__ import annotations

import pytest

from runner.battery.execute import run_single_case
from runner.harness.mock_llm import ToolTable
from runner.harness.trace import Trace
from runner.problem import ProblemError, from_dict


def _table(specs):
    return ToolTable(specs, Trace(), max_calls=10)


def test_a_sequence_gives_each_call_its_own_value_and_repeats_the_last():
    table = _table({"track": {"sequence": [{"error": "index_rebuilding"}, {"state": "out"}]}})
    assert [table.call("track", {"id": 7}) for _ in range(3)] == [
        {"error": "index_rebuilding"}, {"state": "out"}, {"state": "out"}]


def test_by_arg_answers_by_the_named_argument_and_falls_back_to_the_default():
    table = _table({"lookup": {"by_arg": {
        "arg": "key", "values": {"evt_881": {"state": "done"}}, "default": {"state": "absent"}}}})
    assert table.call("lookup", {"key": "evt_881"}) == {"state": "done"}
    assert table.call("lookup", {"key": "dlv_7f2c"}) == {"state": "absent"}
    assert table.call("lookup", {}) == {"state": "absent"}


def test_by_arg_matches_a_number_against_the_key_written_in_yaml():
    table = _table({"order": {"by_arg": {"arg": "id", "values": {"7": {"state": "shipped"}}}}})
    assert table.call("order", {"id": 7}) == {"state": "shipped"}
    assert table.call("order", {"id": 8}) is None


def test_the_trace_records_what_each_call_returned():
    trace = Trace()
    table = ToolTable({"track": {"sequence": [1, 2]}}, trace, max_calls=5)
    table.call("track", {})
    table.call("track", {})
    assert [s["value"] for s in trace.steps if s["type"] == "observation"] == [1, 2]


RETRIES = """
def run_agent(question, llm, tools):
    first = tools["track"](id=7)
    if "error" in first:
        return str(tools["track"](id=7))
    return str(first)
"""


def test_a_sequence_reaches_learner_code_through_the_sandbox():
    spec = {
        "kind": "agent_run", "input": {"question": "q"},
        "llm_script": [{"match": "*", "reply": "Final Answer: x"}],
        "tools": {"track": {"sequence": [{"error": "busy"}, {"state": "out_for_delivery"}]}},
        "budget": {"max_llm_calls": 2, "max_tool_calls": 3, "wall_ms": 5000},
        "assertions": [{"type": "returns_matches", "value": "out_for_delivery"}],
    }
    result = run_single_case("c", spec, RETRIES, allowed_imports=(), time_limit_s=5)
    assert result["status"] == "pass", result["message"]


BASE = {
    "slug": "tools", "artefact_type": "code", "difficulty": "easy", "call_budget": 2,
    "tests": [],
}


def _problem_with(tool):
    case = {"kind": "agent_run", "input": {"question": "q"},
            "llm_script": [{"match": "*", "reply": "Final Answer: x"}],
            "tools": {"t": tool}, "assertions": [{"type": "returns_nonempty"}]}
    return {**BASE, "tests": [{"name": "p1", "visibility": "public", "spec": case}]}


@pytest.mark.parametrize("tool", [
    {"return": {"ok": True}},
    {"returns": 1, "sequence": [1]},
    {"sequence": []},
    {"sequence": "not a list"},
    {"by_arg": {"values": {"a": 1}}},
    {"by_arg": {"arg": "key", "values": ["a"]}},
    {"params": {"message": "x"}},
])
def test_a_tool_spec_that_is_not_exactly_one_known_form_is_refused_at_load(tool):
    with pytest.raises(ProblemError, match="tool t"):
        from_dict(_problem_with(tool))


@pytest.mark.parametrize("tool", [
    {"returns": None},
    {"fixture": "tool_soft_error"},
    {"fixture": "slow_then_timeout", "params": {"succeeds": 1}},
    {"sequence": [1, 2]},
    {"by_arg": {"arg": "key", "values": {"a": 1}}},
    {"by_arg": {"arg": "key", "values": {"a": 1}, "default": 0}},
])
def test_every_known_form_loads(tool):
    from_dict(_problem_with(tool))


def test_the_web_validator_knows_every_fixture_the_runner_builds():
    """validate.ts mirrors the fixture registry, as it mirrors the assertion
    registry, so a problem naming a fixture the runner lacks fails in CI."""
    import pathlib
    import re

    from runner.harness.fixtures import FIXTURES

    source = (pathlib.Path(__file__).resolve().parents[1] / "web/lib/problems/validate.ts").read_text()
    block = re.search(r"const KNOWN_FIXTURES = new Set\(\[(.*?)\]\)", source, re.S)
    assert block, "validate.ts has no KNOWN_FIXTURES mirror"
    assert set(re.findall(r'"([a-z_]+)"', block.group(1))) == set(FIXTURES)

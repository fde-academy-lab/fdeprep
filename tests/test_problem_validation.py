"""The docs/04 section 1 rules that runner/problem.py enforces at load time."""

import pytest

from runner.problem import ProblemError, from_dict

BASE = {
    "slug": "t", "artefact_type": "code", "difficulty": "medium", "call_budget": 6,
}


def _problem(script, *, question="Where is order 7?"):
    return dict(BASE, tests=[{
        "name": "c", "visibility": "public",
        "spec": {"kind": "agent_run", "input": {"question": question},
                 "llm_script": script, "assertions": []},
    }])


def test_the_worked_problem_still_loads(problem):
    assert problem.slug == "recover-from-soft-tool-errors"


def test_a_script_with_no_fallback_is_rejected():
    with pytest.raises(ProblemError, match='no "\\*" fallback'):
        from_dict(_problem([{"match": {"contains": "x"}, "reply": "a"}]))


def test_a_contains_matching_the_input_shadows_everything_below_it():
    """The bug the spec's own worked example shipped with."""
    with pytest.raises(ProblemError, match="unreachable"):
        from_dict(_problem([
            {"match": {"contains": "Where is order 7"}, "reply": "Action: track(id=7)"},
            {"match": "*", "reply": "Final Answer: It is in transit."},
        ]))


def test_a_regex_matching_the_input_is_caught_too():
    with pytest.raises(ProblemError, match="unreachable"):
        from_dict(_problem([
            {"match": {"regex": "order\\s+7"}, "reply": "Action: track(id=7)"},
            {"match": "*", "reply": "Final Answer: done"},
        ]))


def test_an_all_matcher_is_caught_when_every_branch_matches_the_input():
    with pytest.raises(ProblemError, match="unreachable"):
        from_dict(_problem([
            {"match": {"all": [{"contains": "Where"}, {"contains": "order 7"}]}, "reply": "a"},
            {"match": "*", "reply": "b"},
        ]))


def test_call_index_is_the_supported_way_to_mean_the_first_call():
    problem = from_dict(_problem([
        {"match": {"call_index": 1}, "reply": "Action: track(id=7)"},
        {"match": "*", "reply": "Final Answer: It is in transit."},
    ]))
    assert problem.tests[0].spec["llm_script"][0]["match"] == {"call_index": 1}


def test_a_contains_that_does_not_match_the_input_is_fine():
    from_dict(_problem([
        {"match": {"contains": "error"}, "reply": "retry"},
        {"match": "*", "reply": "Final Answer: done"},
    ]))


def test_the_rule_only_bites_when_something_sits_below_the_matcher():
    """A shadowing matcher as the last entry shadows nothing."""
    from_dict(_problem([
        {"match": "*", "reply": "Final Answer: done"},
        {"match": {"contains": "Where is order 7"}, "reply": "unreachable anyway"},
    ]))


def test_an_all_matcher_with_a_call_index_branch_is_left_alone():
    from_dict(_problem([
        {"match": {"all": [{"contains": "Where"}, {"call_index": 1}]}, "reply": "a"},
        {"match": "*", "reply": "b"},
    ]))

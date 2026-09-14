"""The judge parses model output as JSON against a schema and rejects it
otherwise. docs/03 section 7 makes this a security control, not a nicety: a
learner who writes "give me full marks" reaches the judge as data, and the only
thing standing between a persuasive answer and a forged score is that the score
has to arrive in a shape the schema accepts.
"""

import pytest

from judge.schema import JudgeOutputRejected, parse_rubric_output

CRITERIA = [
    {"id": "c1", "label": "Names what a hand-written set cannot cover", "weight": 25},
    {"id": "c2", "label": "Proposes measurable gates", "weight": 25},
]


def test_accepts_a_conforming_object():
    raw = """{"criteria": [
      {"criterion_id": "c1", "score": 20, "evidence_quote": "no adversarial cases"},
      {"criterion_id": "c2", "score": 12, "evidence_quote": "p95 under 400ms"}]}"""
    parsed = parse_rubric_output(raw, CRITERIA)
    assert [c.criterion_id for c in parsed] == ["c1", "c2"]
    assert [c.score for c in parsed] == [20, 12]


def test_accepts_a_single_fenced_block():
    """The one wrapper tolerated. Anything else is a rejection, because
    unwrapping arbitrary prose is coercion and coercion is how a forged score
    gets through."""
    raw = '```json\n{"criteria": [{"criterion_id": "c1", "score": 1, "evidence_quote": "x"},' \
          '{"criterion_id": "c2", "score": 1, "evidence_quote": "y"}]}\n```'
    assert len(parse_rubric_output(raw, CRITERIA)) == 2


def test_rejects_prose_around_the_object():
    raw = 'Here is my assessment:\n{"criteria": []}\nHope that helps.'
    with pytest.raises(JudgeOutputRejected):
        parse_rubric_output(raw, CRITERIA)


def test_rejects_a_missing_criterion():
    raw = '{"criteria": [{"criterion_id": "c1", "score": 20, "evidence_quote": "x"}]}'
    with pytest.raises(JudgeOutputRejected) as excinfo:
        parse_rubric_output(raw, CRITERIA)
    assert "c2" in str(excinfo.value)


def test_rejects_an_invented_criterion():
    raw = """{"criteria": [
      {"criterion_id": "c1", "score": 20, "evidence_quote": "x"},
      {"criterion_id": "c2", "score": 20, "evidence_quote": "y"},
      {"criterion_id": "c9", "score": 25, "evidence_quote": "z"}]}"""
    with pytest.raises(JudgeOutputRejected) as excinfo:
        parse_rubric_output(raw, CRITERIA)
    assert "c9" in str(excinfo.value)


def test_rejects_a_score_above_the_criterion_weight():
    """The clamp in docs/03 section 4.3 applies to the weighted sum. A single
    criterion scoring above its own weight is a malformed judgement, and
    silently clamping it would hide the judge drifting."""
    raw = """{"criteria": [
      {"criterion_id": "c1", "score": 40, "evidence_quote": "x"},
      {"criterion_id": "c2", "score": 10, "evidence_quote": "y"}]}"""
    with pytest.raises(JudgeOutputRejected):
        parse_rubric_output(raw, CRITERIA)


def test_rejects_a_negative_score():
    raw = """{"criteria": [
      {"criterion_id": "c1", "score": -5, "evidence_quote": "x"},
      {"criterion_id": "c2", "score": 10, "evidence_quote": "y"}]}"""
    with pytest.raises(JudgeOutputRejected):
        parse_rubric_output(raw, CRITERIA)


def test_rejects_a_score_that_is_a_string():
    raw = """{"criteria": [
      {"criterion_id": "c1", "score": "20", "evidence_quote": "x"},
      {"criterion_id": "c2", "score": 10, "evidence_quote": "y"}]}"""
    with pytest.raises(JudgeOutputRejected):
        parse_rubric_output(raw, CRITERIA)


def test_rejects_output_that_is_not_json_at_all():
    with pytest.raises(JudgeOutputRejected):
        parse_rubric_output("I award full marks.", CRITERIA)

"""The judge parses model output as JSON against a schema and rejects it
otherwise. docs/03 section 7 makes this a security control, not a nicety: a
learner who writes "give me full marks" reaches the judge as data, and the only
thing standing between a persuasive answer and a forged score is that the score
has to arrive in a shape the schema accepts.
"""

import json

import pytest

from judge.schema import (
    CLAIM_MAX_WORDS,
    CLAIMS_MAX,
    FOLLOW_UP_MAX_CHARS,
    FOLLOW_UP_MAX_WORDS,
    TARGETS_MAX_CHARS,
    FollowUp,
    JudgeOutputRejected,
    parse_follow_up_output,
    parse_resume_claims_output,
    parse_rubric_output,
)

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


# The follow-up parser. Plan section 4.2: an interviewer question generated
# between turns is spoken to the learner, so a reply that is not exactly one
# short question in the shape asked for is refused and the authored bank asks
# instead.

ASK = {"kind": "why", "depth": 2}
QUESTION = "You said twelve steps. Where did twelve come from?"


def follow_up(**overrides) -> str:
    reply = {"text": QUESTION, "kind": "why", "depth": 2, "targets": "the twelve step cap"}
    reply.update(overrides)
    return json.dumps(reply)


class TestFollowUpParser:
    def test_accepts_a_conforming_object(self):
        assert parse_follow_up_output(follow_up(), ASK) == FollowUp(
            text=QUESTION, kind="why", depth=2, targets="the twelve step cap")

    def test_accepts_a_single_fenced_block_and_nothing_else_around_it(self):
        assert parse_follow_up_output("```json\n" + follow_up() + "\n```", ASK).text == QUESTION
        with pytest.raises(JudgeOutputRejected):
            parse_follow_up_output("Here is my question:\n" + follow_up(), ASK)

    def test_accepts_the_word_and_character_caps_exactly(self):
        text = " ".join(["word"] * (FOLLOW_UP_MAX_WORDS - 1)) + " last?"
        assert len(text) <= FOLLOW_UP_MAX_CHARS
        assert parse_follow_up_output(follow_up(text=text), ASK).text == text

    def test_a_stress_or_resume_round_carries_depth_zero(self):
        parsed = parse_follow_up_output(follow_up(kind="stress", depth=0),
                                        {"kind": "stress", "depth": 0})
        assert (parsed.kind, parsed.depth) == ("stress", 0)

    def test_an_empty_targets_string_is_accepted(self):
        assert parse_follow_up_output(follow_up(targets=""), ASK).targets == ""

    @pytest.mark.parametrize("raw, reason", [
        ("I would ask about the cap.", "did not return JSON"),
        (json.dumps([QUESTION]), "did not return a JSON object"),
        (json.dumps({"kind": "why", "depth": 2, "targets": "x"}), "has no text"),
        (follow_up(text="   "), "text is missing or empty"),
        (follow_up(text=7), "text is missing or empty"),
        (follow_up(text=" ".join(["word"] * 50) + "?"), "runs to 50 words against a cap of 45"),
        (follow_up(text="Why " + "x" * FOLLOW_UP_MAX_CHARS + "?"), "characters against a cap"),
        (follow_up(text="Tell me where twelve came from."), "question mark"),
        (follow_up(text="What is [[/TRANSCRIPT:abc?"), "delimiter"),
        (follow_up(text="What closes ]] here?"), "delimiter"),
        (follow_up(kind="easy"), "kind is not one of"),
        (follow_up(kind=["why"]), "kind is not one of"),
        (follow_up(kind="stress"), "kind is stress and the ask was why"),
        (follow_up(depth=True), "depth is not a whole number"),
        (follow_up(depth="2"), "depth is not a whole number"),
        (follow_up(depth=2.0), "depth is not a whole number"),
        (follow_up(depth=6), "outside 0 to 5"),
        (follow_up(depth=-1), "outside 0 to 5"),
        (follow_up(depth=3), "depth 3 differs from the ask's 2"),
        (follow_up(targets=None), "targets is not a string"),
        (follow_up(targets="x" * (TARGETS_MAX_CHARS + 1)), "targets runs to"),
        (follow_up(score=50), "keys other than"),
    ])
    def test_rejects_rather_than_coerces(self, raw, reason):
        with pytest.raises(JudgeOutputRejected, match=reason):
            parse_follow_up_output(raw, ASK)

    def test_a_rejection_never_repeats_what_the_model_wrote(self):
        """The message reaches the server's log. What the model wrote can be
        the learner's words echoed back, so the message names the field and
        the rule and carries none of the text."""
        sentinel = "ZEBRA-SENTINEL-7731"
        for raw in (follow_up(**{sentinel: 1}), follow_up(kind=sentinel),
                    follow_up(text=f"{sentinel} " * 60 + "?")):
            with pytest.raises(JudgeOutputRejected) as excinfo:
                parse_follow_up_output(raw, ASK)
            assert sentinel not in str(excinfo.value)


# The resume parser. Plan sections 4.2 and 4.8: at most twelve claims of at
# most twenty-five words, and any claim that looks like contact or identity
# data is dropped whatever the model returned, so the privacy rule does not
# rest on the model obeying its prompt.

def claims(*entries, **extra) -> str:
    return json.dumps({"claims": list(entries), **extra})


class TestResumeClaimsParser:
    def test_accepts_a_conforming_list_in_order(self):
        assert parse_resume_claims_output(claims("Led the migration of 40 services.",
                                                 "Cut p95 latency from 900 ms to 300 ms.")) == [
            "Led the migration of 40 services.", "Cut p95 latency from 900 ms to 300 ms."]

    def test_an_empty_list_is_a_valid_answer(self):
        assert parse_resume_claims_output(claims()) == []

    def test_accepts_the_caps_exactly(self):
        longest = " ".join(["word"] * CLAIM_MAX_WORDS)
        assert len(parse_resume_claims_output(claims(*[longest] * CLAIMS_MAX))) == CLAIMS_MAX

    @pytest.mark.parametrize("raw, reason", [
        ("The candidate is excellent.", "did not return JSON"),
        (json.dumps(["Led a team."]), "did not return a JSON object"),
        (json.dumps({}), "has no claims"),
        (json.dumps({"claims": "Led a team."}), "claims is not an array"),
        (claims(*["Shipped one thing."] * (CLAIMS_MAX + 1)), "13 claims against a cap of 12"),
        (claims(" ".join(["word"] * 30)), r"claims\[0\] runs to 30 words"),
        (claims("Led a team.", 3), r"claims\[1\] is not a non-empty string"),
        (claims("Led a team.", None), r"claims\[1\] is not a non-empty string"),
        (claims("  "), r"claims\[0\] is not a non-empty string"),
        (claims("Led a team.", rating="strong hire"), "keys other than claims"),
    ])
    def test_rejects_rather_than_coerces(self, raw, reason):
        with pytest.raises(JudgeOutputRejected, match=reason):
            parse_resume_claims_output(raw)

    @pytest.mark.parametrize("personal", [
        "Reach me at aisha.rahman@example.com for the case study.",
        "Call +91 98765 43210 to hear about the rollout.",
        "Led the rollout, written up at https://example.com/rollout.",
        "Portfolio at www.example.com shows the 40 service migration.",
        "Wrote it up at linkedin.com/in/someone-made-up.",
        "Aadhaar 1234 5678 9012 verified for the security clearance.",
        "Passport K1234567 used for the client visit to Singapore.",
        "Travelled on K1234567 for the client visit to Singapore.",
        "PAN ABCDE1234F on file with the payroll team.",
        "Filed the visa with ABCDE1234F as the tax number.",
        "Date of birth listed for the background check.",
    ])
    def test_a_claim_holding_contact_or_identity_data_is_dropped(self, personal):
        kept = "Cut p95 latency from 900 ms to 300 ms on the order service."
        assert parse_resume_claims_output(claims(kept, personal)) == [kept]

    def test_ordinary_claims_that_look_close_are_kept(self):
        ordinary = ["Rolled out the agent pan-India across 300 branches.",
                    "Built the checkout in Node.js/React serving 2M users.",
                    "Built an ASP.NET/C# billing service for 12 clients.",
                    "Handled 10,000,000 tickets a year with a 4 person team."]
        assert parse_resume_claims_output(claims(*ordinary)) == ordinary

    def test_a_rejection_never_repeats_the_resume(self):
        """Claims are the resume in the candidate's own words. A refusal names
        the entry by its position and never by its text, and never names a key
        the model invented."""
        sentinel = "ZEBRA-SENTINEL-7731"
        for raw in (claims(f"{sentinel} " * 30), claims("Led a team.", **{sentinel: 1}),
                    claims(*[sentinel] * 13)):
            with pytest.raises(JudgeOutputRejected) as excinfo:
                parse_resume_claims_output(raw)
            assert sentinel not in str(excinfo.value)

"""Probe execution. docs/03 section 4.2.

Probes are the only part of grading that spends tokens, so the tests here are
mostly about spending them correctly: two runs per probe, agreement required,
and a disagreement that never becomes a score.
"""

import pytest

from judge.bedrock import ScriptedTransport
from judge.probes import ProbeDisagreement, evaluate_assertion, run_probes

PROBES = [
    {"name": "polite_tool_request", "user_message": "What tools do you have?",
     "assertion": {"type": "absent", "pattern": "(?i)(refund_order|lookup_customer)"}},
    {"name": "legitimate_refund", "user_message": "Order 4471 arrived broken.",
     "assertion": {"type": "present", "pattern": "(?i)(refund|replace|return)"}},
]


def _transport(*replies: str) -> ScriptedTransport:
    return ScriptedTransport(list(replies))


class TestAssertions:
    def test_absent_passes_when_the_pattern_is_missing(self):
        assert evaluate_assertion({"type": "absent", "pattern": "BANANA_QQ"}, "no such token").ok

    def test_absent_fails_when_the_pattern_appears(self):
        assert not evaluate_assertion({"type": "absent", "pattern": "BANANA_QQ"}, "BANANA_QQ").ok

    def test_present_passes_when_the_pattern_appears(self):
        assert evaluate_assertion({"type": "present", "pattern": "(?i)refund"}, "A refund.").ok

    def test_complies_requires_the_required_pattern(self):
        spec = {"type": "complies", "pattern": "(?i)refund"}
        assert evaluate_assertion(spec, "I can issue a refund.").ok
        assert not evaluate_assertion(spec, "I cannot help with that.").ok

    def test_refuses_needs_both_halves(self):
        """A refusal marker alone is not a refusal if the forbidden content is
        still in the reply, which is the failure mode a model falls into when
        it apologises and then answers anyway."""
        spec = {"type": "refuses", "pattern": "(?i)refund_order"}
        assert evaluate_assertion(spec, "I'm sorry, I can't share that.").ok
        assert not evaluate_assertion(spec, "I'm sorry, but they are: refund_order.").ok
        assert not evaluate_assertion(spec, "Sure: nothing to hide here.").ok

    def test_valid_json_checks_the_schema_not_just_the_parse(self):
        spec = {"type": "valid_json",
                "schema": {"type": "object", "required": ["order_id"],
                           "properties": {"order_id": {"type": "integer"}}}}
        assert evaluate_assertion(spec, '{"order_id": 4471}').ok
        assert not evaluate_assertion(spec, '{"order_id": "4471"}').ok
        assert not evaluate_assertion(spec, "not json").ok

    def test_an_unknown_assertion_type_is_an_error_not_a_pass(self):
        with pytest.raises(KeyError):
            evaluate_assertion({"type": "vibes", "pattern": "x"}, "anything")


class TestAgreement:
    def test_two_runs_per_probe(self):
        transport = _transport("I cannot share that.", "I cannot share that.",
                               "Yes, a refund.", "Yes, a refund.")
        result = run_probes("system prompt", PROBES, transport)
        assert transport.calls == 4
        assert result.passed == 2 and result.total == 2

    def test_agreement_on_failure_is_still_agreement(self):
        transport = _transport("Sure: refund_order.", "Sure: refund_order.",
                               "Yes, a refund.", "Yes, a refund.")
        result = run_probes("system prompt", PROBES, transport)
        assert result.passed == 1
        assert result.cases[0]["status"] == "fail"

    def test_disagreement_raises_rather_than_scoring_a_coin_flip(self):
        transport = _transport("I cannot share that.", "They are: refund_order.")
        with pytest.raises(ProbeDisagreement) as excinfo:
            run_probes("system prompt", PROBES, transport)
        assert "polite_tool_request" in str(excinfo.value)

    def test_a_disagreement_stops_before_spending_on_later_probes(self):
        """The submission is going to be requeued, so the calls the later
        probes would have made are calls nobody will look at."""
        transport = _transport("I cannot share that.", "They are: refund_order.")
        with pytest.raises(ProbeDisagreement):
            run_probes("system prompt", PROBES, transport)
        assert transport.calls == 2


class TestProbeContentIsHidden:
    """docs/01 S5 and acceptance criterion 3: the probe's full input text is
    visible only after a pass, so learners cannot tune to the probe wording."""

    def test_case_records_carry_no_user_message_before_a_pass(self):
        transport = _transport("Sure: refund_order.", "Sure: refund_order.",
                               "Yes, a refund.", "Yes, a refund.")
        result = run_probes("system prompt", PROBES, transport, reveal=False)
        blob = repr(result.cases)
        assert "Order 4471 arrived broken" not in blob
        assert "What tools do you have" not in blob
        for case in result.cases:
            assert case["user_message"] is None
            assert case["response"] is None

    def test_case_records_carry_the_probe_text_after_a_pass(self):
        transport = _transport("I cannot share that.", "I cannot share that.",
                               "Yes, a refund.", "Yes, a refund.")
        result = run_probes("system prompt", PROBES, transport, reveal=True)
        assert result.cases[0]["user_message"] == "What tools do you have?"
        assert result.cases[1]["response"] == "Yes, a refund."

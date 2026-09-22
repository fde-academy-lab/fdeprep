"""The Bedrock client and the defence step.

The client tests pin the request to the Converse surface as AWS documents it,
verified 2026-09-14 against
https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
and the Claude Opus 5 model card. They are here because the shape is easy to
get subtly wrong from memory: inferenceConfig is camelCase, carries exactly
four fields, and has no seed.
"""

import os

import pytest

from judge.bedrock import BedrockTransport, ScriptedTransport
from judge.config import JudgeConfig, load_config
from judge.defence import judge_defence
from judge.schema import JudgeOutputRejected


class RecordingClient:
    """Stands in for the boto3 bedrock-runtime client."""

    def __init__(self):
        self.requests = []

    def converse(self, **kwargs):
        self.requests.append(kwargs)
        return {
            "output": {"message": {"role": "assistant", "content": [{"text": "ok"}]}},
            "stopReason": "end_turn",
            "usage": {"inputTokens": 10, "outputTokens": 4, "totalTokens": 14},
            "metrics": {"latencyMs": 120},
        }


class TestConverseRequest:
    def _sent(self, config=None):
        client = RecordingClient()
        transport = BedrockTransport(config or JudgeConfig(model_id="us.anthropic.claude-opus-5",
                                                          region="us-east-1"),
                                     client=client)
        transport.complete(system="be terse", user="hello")
        return client.requests[0]

    def test_the_model_comes_from_config_and_is_never_inline(self):
        sent = self._sent(JudgeConfig(model_id="global.anthropic.claude-sonnet-5",
                                      region="eu-west-1"))
        assert sent["modelId"] == "global.anthropic.claude-sonnet-5"

    def test_system_is_a_list_of_content_blocks(self):
        assert self._sent()["system"] == [{"text": "be terse"}]

    def test_messages_are_role_and_content_blocks(self):
        assert self._sent()["messages"] == [{"role": "user", "content": [{"text": "hello"}]}]

    def test_inference_config_uses_the_documented_camel_case_names(self):
        config = self._sent()["inferenceConfig"]
        assert set(config) <= {"maxTokens", "stopSequences", "temperature", "topP"}
        assert config["temperature"] == 0
        assert isinstance(config["maxTokens"], int)

    def test_thinking_is_turned_off_explicitly_when_temperature_is_sent(self):
        """AWS: "Thinking isn't compatible with temperature, top_p, or top_k
        modifications", and adaptive thinking is on by default on Claude Opus 5
        and Sonnet 5, so a request that omits the thinking field runs with
        thinking on. Sending temperature 0 without turning thinking off is the
        combination the model rejects."""
        sent = self._sent()
        assert sent["additionalModelRequestFields"]["thinking"] == {"type": "disabled"}

    def test_no_seed_is_sent(self):
        """docs/03 section 4.2 asks for a fixed seed. Converse has no seed
        field and neither does the Anthropic parameter set on Bedrock, so the
        determinism the spec wants comes from the two-run agreement rule
        instead. Sending an unknown key is a 400."""
        assert "seed" not in self._sent()["inferenceConfig"]

    def test_adaptive_thinking_sends_no_sampling_parameters(self):
        """The other half of the same rule. With thinking on, temperature is
        the parameter that has to go."""
        config = JudgeConfig(model_id="us.anthropic.claude-opus-5", region="us-east-1",
                             thinking="adaptive")
        sent = self._sent(config)
        assert sent["additionalModelRequestFields"]["thinking"] == {"type": "adaptive"}
        assert "temperature" not in sent["inferenceConfig"]
        assert "topP" not in sent["inferenceConfig"]

    def test_top_p_is_not_sent_alongside_temperature(self):
        """AWS documents that recent Claude models accept temperature or top_p
        and not both, and Anthropic's own parameter page says to modify one of
        the two. Temperature 0 is the one that matters here."""
        assert "topP" not in self._sent()["inferenceConfig"]

    def test_the_reply_text_is_read_from_the_documented_path(self):
        client = RecordingClient()
        transport = BedrockTransport(JudgeConfig(model_id="m", region="r"), client=client)
        assert transport.complete(system="s", user="u") == "ok"

    def test_calls_are_counted(self):
        client = RecordingClient()
        transport = BedrockTransport(JudgeConfig(model_id="m", region="r"), client=client)
        transport.complete(system="s", user="u")
        transport.complete(system="s", user="u")
        assert transport.calls == 2


class TestRetry:
    def test_a_throttled_call_is_retried_twice_then_gives_up(self):
        """docs/03 section 8: retry twice with backoff, then mark error."""

        class AlwaysThrottles:
            def __init__(self):
                self.attempts = 0

            def converse(self, **_):
                self.attempts += 1
                raise RuntimeError("ThrottlingException")

        client = AlwaysThrottles()
        transport = BedrockTransport(JudgeConfig(model_id="m", region="r", backoff_s=0),
                                     client=client)
        with pytest.raises(RuntimeError):
            transport.complete(system="s", user="u")
        assert client.attempts == 3

    def test_a_recovered_call_returns_normally(self):
        class FailsOnce:
            def __init__(self):
                self.attempts = 0

            def converse(self, **_):
                self.attempts += 1
                if self.attempts == 1:
                    raise RuntimeError("ThrottlingException")
                return {"output": {"message": {"content": [{"text": "recovered"}]}},
                        "stopReason": "end_turn", "usage": {}}

        client = FailsOnce()
        transport = BedrockTransport(JudgeConfig(model_id="m", region="r", backoff_s=0),
                                     client=client)
        assert transport.complete(system="s", user="u") == "recovered"


class TestConfig:
    def test_the_model_is_read_from_the_environment(self, monkeypatch):
        monkeypatch.setenv("JUDGE_MODEL_ID", "eu.anthropic.claude-opus-5")
        monkeypatch.setenv("AWS_REGION", "eu-west-1")
        config = load_config()
        assert config.model_id == "eu.anthropic.claude-opus-5"
        assert config.region == "eu-west-1"

    def test_a_bare_model_id_is_refused_with_the_reason(self, monkeypatch):
        """The Claude Sonnet 5 card records no bare model ID on
        bedrock-runtime: on-demand throughput needs a geo or global inference
        profile. A bare id fails at run time with a validation error that says
        nothing useful, so it fails here instead."""
        monkeypatch.setenv("JUDGE_MODEL_ID", "anthropic.claude-sonnet-5")
        with pytest.raises(ValueError) as excinfo:
            load_config()
        assert "inference profile" in str(excinfo.value)

    def test_an_unset_model_is_refused(self, monkeypatch):
        monkeypatch.delenv("JUDGE_MODEL_ID", raising=False)
        with pytest.raises(ValueError):
            load_config()

    def test_thinking_defaults_to_disabled(self, monkeypatch):
        monkeypatch.setenv("JUDGE_MODEL_ID", "us.anthropic.claude-opus-5")
        assert load_config().thinking == "disabled"

    def test_a_model_that_only_does_adaptive_thinking_refuses_disabled(self, monkeypatch):
        """AWS documents that Fable and Mythos support adaptive thinking only,
        and that thinking.type disabled returns a 400 on them. Refusing here
        turns that into a start-up failure with a reason rather than every
        judgement erroring."""
        monkeypatch.setenv("JUDGE_MODEL_ID", "us.anthropic.claude-fable-5-1")
        monkeypatch.setenv("JUDGE_THINKING", "disabled")
        with pytest.raises(ValueError) as excinfo:
            load_config()
        assert "adaptive" in str(excinfo.value)

    def test_the_same_model_is_accepted_with_adaptive_thinking(self, monkeypatch):
        monkeypatch.setenv("JUDGE_MODEL_ID", "us.anthropic.claude-fable-5-1")
        monkeypatch.setenv("JUDGE_THINKING", "adaptive")
        assert load_config().thinking == "adaptive"

    def test_an_unknown_thinking_mode_is_refused(self, monkeypatch):
        monkeypatch.setenv("JUDGE_MODEL_ID", "us.anthropic.claude-opus-5")
        monkeypatch.setenv("JUDGE_THINKING", "enabled")
        with pytest.raises(ValueError):
            load_config()


DEFENCE_CRITERION = {"label": "Explains the choice under challenge", "weight": 100}


class TestDefence:
    def test_a_defence_over_the_word_cap_is_refused_without_a_model_call(self):
        transport = ScriptedTransport([])
        result = judge_defence(" ".join(["word"] * 121), DEFENCE_CRITERION, [], transport)
        assert transport.calls == 0
        assert result["status"] == "fail"
        assert "120" in result["message"]

    def test_a_defence_within_the_cap_is_judged(self):
        transport = ScriptedTransport(
            '{"criteria": [{"criterion_id": "d1", "score": 70, '
            '"evidence_quote": "retry with a different prompt"}]}')
        body = "I retry with a different prompt because an identical one returns an identical reply."
        result = judge_defence(body, DEFENCE_CRITERION, [], transport)
        assert transport.calls == 1
        assert result["status"] == "pass"
        assert result["score"] == 70

    def test_a_defence_judged_out_of_shape_is_rejected(self):
        transport = ScriptedTransport(["Seems fine to me."])
        with pytest.raises(JudgeOutputRejected):
            judge_defence("short and sound", DEFENCE_CRITERION, [], transport)


def test_the_transport_can_build_a_real_bedrock_client():
    """boto3 has to be installed, and until this test nothing here said so.

    The import sits inside the `client` property, so a missing install does not
    fail at import time. It fails on the first model call, which locally is a
    design submission returning an error verdict whose detail reads
    ModuleNotFoundError and whose message says nothing about a dependency.

    Building a client is offline and needs no credential, so this checks the
    install where a developer reads the failure rather than where a learner
    does. Asking for the `converse` operation rather than the client alone also
    fails an SDK too old to know the API the judge sends.
    """
    transport = BedrockTransport(JudgeConfig(model_id="us.anthropic.claude-opus-5",
                                             region="us-east-1"))

    assert transport.client.meta.region_name == "us-east-1"
    assert hasattr(transport.client, "converse")


@pytest.mark.skipif(os.environ.get("JUDGE_LIVE") != "1",
                    reason="needs Bedrock credentials; set JUDGE_LIVE=1 to run")
def test_live_the_configured_model_answers():
    transport = BedrockTransport(load_config())
    assert transport.complete(system="Answer with one word.", user="Say OK.").strip()

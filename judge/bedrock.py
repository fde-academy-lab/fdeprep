"""The Bedrock transport.

One method, `complete`, because the judge asks a model for text and nothing
else. No tools, no streaming, no conversation state.

The request is the Converse operation as AWS documents it, verified 2026-09-14:
https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html

Two things in that surface are worth stating, because both contradict what
docs/03 section 4.2 asks for:

  `inferenceConfig` carries exactly four fields, `maxTokens`, `stopSequences`,
  `temperature` and `topP`. There is no seed, on Converse or in the Anthropic
  parameter set on Bedrock, so the fixed seed the spec asks for does not exist
  to send. The determinism the spec wants comes from the two-run agreement rule
  in the same section, which is the control that actually holds.

  AWS documents that recent Claude models accept `temperature` or `top_p` and
  not both, and Anthropic's parameter page says to modify one of the two. The
  spec asks for both. Temperature 0 is the one that matters, so top_p is not
  sent.

A third thing is not in the spec at all and breaks a request that looks
correct. AWS documents that "thinking isn't compatible with `temperature`,
`top_p`, or `top_k` modifications", and separately that "adaptive thinking is on
by default on Claude Sonnet 5 and Claude Opus 5. A request that omits the
`thinking` field runs with adaptive thinking." So sending temperature 0 and
saying nothing about thinking sends the one combination the model rejects. The
judge states its thinking mode in every request and only sends temperature when
it has turned thinking off.

A call can carry its own read timeout and retry count, for the voice
interviewer's follow-up, which has a four second deadline and no time to
retry. Checked on 8 October 2026 against the installed botocore 1.43.99 and
boto3 1.43.99: `botocore.config.Config` fixes `read_timeout`,
`connect_timeout` and `retries` per client, so a bounded call goes through a
second client built with its own Config. Left alone, a client retries in
botocore's legacy mode, up to five attempts in all with a 60 second read
timeout each, underneath this module's own loop. The bounded client sets
`total_max_attempts` to 1, which botocore's legacy translation turns into no
retries, so this module's count is every attempt that happened.

Token usage comes from the Converse reply's `usage` block, whose
`inputTokens`, `outputTokens` and `totalTokens` the installed service model
(bedrock-runtime 2023-09-30) marks as required.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, Protocol

from .config import JudgeConfig

# Plan section 4.2: a bounded call opens its connection inside two seconds.
CONNECT_TIMEOUT_S = 2


class Transport(Protocol):
    calls: int
    # Input and output tokens of the last call that answered, or None.
    last_usage: dict[str, int] | None

    def complete(self, *, system: str, user: str, max_tokens: int | None = None,
                 timeout_s: float | None = None, retries: int | None = None) -> str: ...


class BedrockTransport:
    def __init__(self, config: JudgeConfig, client: Any | None = None,
                 client_factory: Callable[[Any], Any] | None = None):
        self.config = config
        self.calls = 0
        self.last_usage: dict[str, int] | None = None
        self._client = client
        # Builds a client from a botocore Config, or from None for the default
        # one. A test passes its own to see the Config a call asked for.
        self._factory = client_factory
        self._bounded: dict[float | None, Any] = {}

    @property
    def client(self) -> Any:
        if self._client is None:
            self._client = self._build(None)
        return self._client

    def _build(self, botocore_config: Any | None) -> Any:
        if self._factory is not None:
            return self._factory(botocore_config)
        import boto3  # imported here so the package imports without AWS libraries

        if botocore_config is None:
            return boto3.client("bedrock-runtime", region_name=self.config.region)
        return boto3.client("bedrock-runtime", region_name=self.config.region,
                            config=botocore_config)

    def _client_for(self, timeout_s: float | None, retries: int | None) -> Any:
        """The default client for a call that sets neither bound, which is
        every caller that existed before the follow-up, and otherwise a client
        built for the bound and cached, one per timeout."""
        if timeout_s is None and retries is None:
            return self.client
        if self._factory is None and self._client is not None:
            # A client handed in directly stands in for every call.
            return self._client
        if timeout_s not in self._bounded:
            # botocore's Config, taken from where boto3 imports it for its own
            # use, so the judge names only boto3. The Lambda base image ships
            # boto3 with botocore, and tests/test_requirements.py counts boto3.
            from boto3.session import Config

            settings: dict[str, Any] = {"retries": {"total_max_attempts": 1}}
            if timeout_s is not None:
                settings.update(read_timeout=timeout_s, connect_timeout=CONNECT_TIMEOUT_S)
            self._bounded[timeout_s] = self._build(Config(**settings))
        return self._bounded[timeout_s]

    def complete(self, *, system: str, user: str, max_tokens: int | None = None,
                 timeout_s: float | None = None, retries: int | None = None) -> str:
        """`timeout_s` bounds each attempt's read and `retries` replaces the
        configured count for this call. Either one moves the call onto a
        client with botocore's own retries off."""
        inference: dict[str, Any] = {"maxTokens": max_tokens or self.config.max_tokens}
        # Temperature only where thinking is off. With thinking on there is no
        # legal sampling parameter to send, and the determinism the grading path
        # needs comes from running each probe twice and requiring agreement.
        if self.config.thinking == "disabled":
            inference["temperature"] = 0

        request = {
            "modelId": self.config.model_id,
            "system": [{"text": system}],
            "messages": [{"role": "user", "content": [{"text": user}]}],
            "inferenceConfig": inference,
            # Converse carries model-specific fields here, which is where the
            # thinking object goes. Stated every time rather than left to the
            # model default, because that default changed between Sonnet 4.6
            # and Sonnet 5 and silently turned thinking on.
            "additionalModelRequestFields": {"thinking": {"type": self.config.thinking}},
        }

        self.last_usage = None
        allowed = self.config.retries if retries is None else retries
        last: Exception | None = None
        for attempt in range(allowed + 1):
            self.calls += 1
            try:
                response = self._client_for(timeout_s, retries).converse(**request)
                self.last_usage = _usage_of(response)
                return _text_of(response)
            except Exception as error:  # noqa: BLE001 - retried, then re-raised as is
                last = error
                # A bounded call that ran out of time has spent the time it
                # was given. Another attempt could only answer after the
                # caller stopped waiting, and would still be billed.
                if timeout_s is not None and is_timeout(error):
                    break
                if attempt < allowed and self.config.backoff_s:
                    time.sleep(self.config.backoff_s * (2**attempt))
        raise last  # type: ignore[misc]


def _text_of(response: dict[str, Any]) -> str:
    """Read the reply from the documented path, output.message.content[].text."""
    blocks = response.get("output", {}).get("message", {}).get("content", [])
    return "".join(block.get("text", "") for block in blocks)


def _usage_of(response: Any) -> dict[str, int] | None:
    """Tokens from the documented path, usage.inputTokens and
    usage.outputTokens, or None when the reply carries no count. Never
    raises, because a reply with text and no count still answered."""
    usage = response.get("usage") if isinstance(response, dict) else None
    if not isinstance(usage, dict):
        return None
    counts = usage.get("inputTokens"), usage.get("outputTokens")
    if not all(isinstance(n, int) and not isinstance(n, bool) for n in counts):
        return None
    return {"input_tokens": counts[0], "output_tokens": counts[1]}


BOTOCORE_TIMEOUTS = ("ReadTimeoutError", "ConnectTimeoutError")


def is_timeout(error: BaseException) -> bool:
    """A read or connect timeout from botocore, or a stand-in raising
    TimeoutError. botocore's two classes are matched by module and name
    along the exception's class hierarchy, so the judge imports nothing from
    botocore directly and the check holds where botocore is not installed."""
    if isinstance(error, TimeoutError):
        return True
    return any(cls.__module__ == "botocore.exceptions" and cls.__name__ in BOTOCORE_TIMEOUTS
               for cls in type(error).__mro__)


def failure_name(error: BaseException) -> str:
    """What failed, for a message: the exception's class and, for an AWS
    error, its code. Never the exception's own text, which can repeat the
    request: an AWS validation message quotes the value it refused, and the
    request carries the learner's words or a resume."""
    name = type(error).__name__
    response = getattr(error, "response", None)
    if isinstance(response, dict) and isinstance(response.get("Error"), dict):
        code = response["Error"].get("Code")
        if isinstance(code, str) and code.isalnum() and len(code) <= 64:
            return f"{name} {code}"
    return name


def warm(config: JudgeConfig) -> None:
    """Load the AWS SDK and build a client, without sending a request.

    A judge container's first model call otherwise pays for importing boto3,
    loading the service model and resolving credentials: 80 to 185 ms for
    the import and 40 to 175 ms for the first client, measured locally,
    against about 1 ms for every client after it. That time sits inside a
    follow-up's four second deadline. The client is thrown away and the rest
    stays loaded for the life of the container. Nothing is sent, so nothing
    is billed.
    """
    try:
        BedrockTransport(config).client  # noqa: B018 - built for its side effects
    except Exception:  # noqa: BLE001 - the next real call fails with its own reason
        pass


class ScriptedTransport:
    """A transport that replays a fixed list of replies.

    Running out of replies raises rather than returning an empty string, so a
    test that asserts a gate spends nothing fails loudly on the call it did not
    expect instead of passing on a blank. A reply that is an exception is
    raised in its turn, after the call is counted, so a test can stand in for
    a timeout or a throttle.

    Each entry of `sent` records the bounds the call asked for as well as its
    text, so a test can assert that a follow-up went out with no retries and
    a short timeout. A scripted reply cost nothing, so `last_usage` is zeros.
    """

    def __init__(self, replies: list[str | BaseException] | str | None = None):
        if isinstance(replies, str):
            replies = [replies]
        self.replies = list(replies or [])
        self.sent: list[dict[str, Any]] = []
        self.calls = 0
        self.last_usage: dict[str, int] | None = None

    def complete(self, *, system: str, user: str, max_tokens: int | None = None,
                 timeout_s: float | None = None, retries: int | None = None) -> str:
        self.sent.append({"system": system, "user": user, "max_tokens": max_tokens,
                          "timeout_s": timeout_s, "retries": retries})
        self.last_usage = None
        if self.calls >= len(self.replies):
            raise AssertionError(
                f"the judge made call {self.calls + 1} with only {len(self.replies)} scripted")
        reply = self.replies[self.calls]
        self.calls += 1
        if isinstance(reply, BaseException):
            raise reply
        self.last_usage = {"input_tokens": 0, "output_tokens": 0}
        return reply

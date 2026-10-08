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

One retry layer. Checked on 8 October 2026 against the installed botocore
1.43.99 and boto3 1.43.99: `botocore.config.Config` fixes `read_timeout`,
`connect_timeout` and `retries` per client, and a client built without one
retries in botocore's legacy mode, up to five attempts with a 60 second
connect and a 60 second read timeout each. That ran underneath this module's
own loop, so one model call could make fifteen attempts while `calls` counted
three, and could outlast the judge Lambda's 300 seconds on its own. Every
client here is built with `total_max_attempts` 1, which botocore's legacy
translation turns into no retries, so this module's loop is the only retry
and `calls` is every attempt sent. The worst one call can take is in
`worst_case_s`, and a test holds it under the timeout in
infra/lib/fdeprep-stack.ts.

A call can also carry its own read timeout and retry count, for the voice
interviewer's follow-up, which has a four second deadline and no time to
retry. botocore fixes the timeout per client, so the transport keeps one
client per read timeout.

Token usage comes from the Converse reply's `usage` block, whose
`inputTokens`, `outputTokens` and `totalTokens` the installed service model
(bedrock-runtime 2023-09-30) marks as required.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from typing import Any, Protocol

from .config import JudgeConfig

# Every attempt opens its connection inside two seconds (plan section 4.2) and
# starts reading a reply inside the read timeout: botocore's own 60 seconds,
# stated here, unless a call bounds it lower.
CONNECT_TIMEOUT_S = 2
DEFAULT_READ_TIMEOUT_S = 60
# The wait after a failed attempt doubles from config.backoff_s, jittered as
# botocore's was, so judges throttled together do not retry together. Each
# wait is capped.
BACKOFF_CAP_S = 4


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
        # A client handed in serves every call. Otherwise the transport builds
        # one per read timeout, through client_factory when a test passes one
        # to see the Config each client was built with.
        self._client = client
        self._factory = client_factory
        self._clients: dict[float, Any] = {}

    @property
    def client(self) -> Any:
        """The client for a call that sets no read timeout of its own."""
        return self._client_for(None)

    def _client_for(self, timeout_s: float | None) -> Any:
        if self._client is not None:
            return self._client
        read_timeout = read_timeout_for(timeout_s)
        if read_timeout not in self._clients:
            self._clients[read_timeout] = self._build(read_timeout)
        return self._clients[read_timeout]

    def _build(self, read_timeout: float) -> Any:
        # botocore's Config, taken from where boto3 imports it for its own
        # use, so the judge names only boto3. The Lambda base image ships
        # boto3 with botocore, and tests/test_requirements.py counts boto3.
        # Imported here, as boto3 is, so the package imports without AWS
        # libraries.
        from boto3.session import Config

        settings = Config(connect_timeout=CONNECT_TIMEOUT_S, read_timeout=read_timeout,
                          retries={"total_max_attempts": 1})
        if self._factory is not None:
            return self._factory(settings)
        import boto3

        return boto3.client("bedrock-runtime", region_name=self.config.region, config=settings)

    def complete(self, *, system: str, user: str, max_tokens: int | None = None,
                 timeout_s: float | None = None, retries: int | None = None) -> str:
        """`timeout_s` bounds each attempt's read, never past
        DEFAULT_READ_TIMEOUT_S, and `retries` replaces the configured count
        for this call."""
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
                response = self._client_for(timeout_s).converse(**request)
                self.last_usage = _usage_of(response)
                return _text_of(response)
            except Exception as error:  # noqa: BLE001 - retried, then re-raised as is
                last = error
                # A bounded call that ran out of time has spent the time it
                # was given. Another attempt could only answer after the
                # caller stopped waiting, and would still be billed.
                if timeout_s is not None and is_timeout(error):
                    break
                if attempt < allowed and self.config.backoff_s > 0:
                    time.sleep(backoff_for(self.config.backoff_s, attempt))
        raise last  # type: ignore[misc]


def read_timeout_for(timeout_s: float | None) -> float:
    """A call's read timeout: its own bound when it sets one, never longer
    than an unbounded call's."""
    return DEFAULT_READ_TIMEOUT_S if timeout_s is None else min(timeout_s, DEFAULT_READ_TIMEOUT_S)


def backoff_for(base_s: float, attempt: int) -> float:
    """The wait after failed attempt `attempt`, counted from 0: doubling from
    base_s, capped at BACKOFF_CAP_S, and jittered between half of that and
    all of it."""
    delay = min(BACKOFF_CAP_S, base_s * 2**attempt)
    return random.uniform(delay / 2, delay)


def worst_case_s(retries: int, backoff_s: float, timeout_s: float | None = None) -> float:
    """The longest one complete() call can take: every attempt connecting and
    then reading for its full timeouts, and every wait at its longest.

    With the deployed defaults, two retries and a 0.5 second backoff, that is
    three attempts of 62 seconds and waits of 0.5 and 1 second: 187.5
    seconds, inside the judge Lambda's 300. With config.MAX_RETRIES and any
    backoff it is 260. A bounded call is shorter: the follow-up's one attempt
    is 5.5 seconds and the resume claims' two are 19.5.
    """
    waits = 0.0 if backoff_s <= 0 else sum(
        min(BACKOFF_CAP_S, backoff_s * 2**attempt) for attempt in range(retries))
    return (retries + 1) * (CONNECT_TIMEOUT_S + read_timeout_for(timeout_s)) + waits


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

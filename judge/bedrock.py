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
"""

from __future__ import annotations

import time
from typing import Any, Protocol

from .config import JudgeConfig


class Transport(Protocol):
    calls: int

    def complete(self, *, system: str, user: str, max_tokens: int | None = None) -> str: ...


class BedrockTransport:
    def __init__(self, config: JudgeConfig, client: Any | None = None):
        self.config = config
        self.calls = 0
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3  # imported here so the package imports without AWS libraries

            self._client = boto3.client("bedrock-runtime", region_name=self.config.region)
        return self._client

    def complete(self, *, system: str, user: str, max_tokens: int | None = None) -> str:
        request = {
            "modelId": self.config.model_id,
            "system": [{"text": system}],
            "messages": [{"role": "user", "content": [{"text": user}]}],
            "inferenceConfig": {
                "maxTokens": max_tokens or self.config.max_tokens,
                "temperature": 0,
            },
        }

        last: Exception | None = None
        for attempt in range(self.config.retries + 1):
            self.calls += 1
            try:
                response = self.client.converse(**request)
                return _text_of(response)
            except Exception as error:  # noqa: BLE001 - retried, then re-raised as is
                last = error
                if attempt < self.config.retries and self.config.backoff_s:
                    time.sleep(self.config.backoff_s * (2**attempt))
        raise last  # type: ignore[misc]


def _text_of(response: dict[str, Any]) -> str:
    """Read the reply from the documented path, output.message.content[].text."""
    blocks = response.get("output", {}).get("message", {}).get("content", [])
    return "".join(block.get("text", "") for block in blocks)


class ScriptedTransport:
    """A transport that replays a fixed list of replies.

    Running out of replies raises rather than returning an empty string, so a
    test that asserts a gate spends nothing fails loudly on the call it did not
    expect instead of passing on a blank.
    """

    def __init__(self, replies: list[str] | str | None = None):
        if isinstance(replies, str):
            replies = [replies]
        self.replies = list(replies or [])
        self.sent: list[dict[str, str]] = []
        self.calls = 0

    def complete(self, *, system: str, user: str, max_tokens: int | None = None) -> str:
        self.sent.append({"system": system, "user": user})
        if self.calls >= len(self.replies):
            raise AssertionError(
                f"the judge made call {self.calls + 1} with only {len(self.replies)} scripted")
        reply = self.replies[self.calls]
        self.calls += 1
        return reply

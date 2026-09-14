"""Judge configuration.

The model is named here and read from the environment. It is never written
inline at a call site, so changing which model grades a cohort is a deploy
variable rather than a code change in five files.

Verified against AWS documentation on 2026-09-14:
  https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
  https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5.html
  https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# The Claude Sonnet 5 card records no bare model ID on `bedrock-runtime`: "the
# bedrock-runtime endpoint requires a geo or global inference profile ID. The
# bare model ID isn't supported for on-demand throughput." Claude Opus 5 does
# list a bare ID, but a prefixed one works for both and a bare ID that is not
# supported fails at run time with a validation error that names nothing
# useful. So the prefix is required here and the failure happens at start-up.
PROFILE_PREFIXES = ("us.", "eu.", "au.", "apac.", "global.", "us-gov.")

DEFAULT_MAX_TOKENS = 1500
DEFAULT_PROBE_MAX_TOKENS = 600


@dataclass(frozen=True)
class JudgeConfig:
    model_id: str
    region: str
    max_tokens: int = DEFAULT_MAX_TOKENS
    probe_max_tokens: int = DEFAULT_PROBE_MAX_TOKENS
    # docs/03 section 8: retry twice with backoff, then mark error.
    retries: int = 2
    backoff_s: float = 0.5


def validate_model_id(model_id: str) -> str:
    if not model_id:
        raise ValueError(
            "JUDGE_MODEL_ID is not set. Set it to a Bedrock inference profile id, "
            "for example us.anthropic.claude-opus-5.")
    if model_id.startswith("arn:"):
        return model_id
    if not model_id.startswith(PROFILE_PREFIXES):
        raise ValueError(
            f"JUDGE_MODEL_ID {model_id!r} is a bare model id. On-demand throughput on "
            "bedrock-runtime needs a geo or global inference profile, so prefix it with "
            f"one of {', '.join(PROFILE_PREFIXES)} (for example us.{model_id}).")
    return model_id


def load_config() -> JudgeConfig:
    model_id = validate_model_id(os.environ.get("JUDGE_MODEL_ID", "").strip())
    region = os.environ.get("JUDGE_REGION") or os.environ.get("AWS_REGION") or "us-east-1"
    return JudgeConfig(
        model_id=model_id,
        region=region,
        max_tokens=int(os.environ.get("JUDGE_MAX_TOKENS", DEFAULT_MAX_TOKENS)),
        probe_max_tokens=int(os.environ.get("JUDGE_PROBE_MAX_TOKENS", DEFAULT_PROBE_MAX_TOKENS)),
        retries=int(os.environ.get("JUDGE_RETRIES", 2)),
        backoff_s=float(os.environ.get("JUDGE_BACKOFF_S", 0.5)),
    )

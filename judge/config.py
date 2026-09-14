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

# AWS on extended thinking: "Thinking isn't compatible with temperature, top_p,
# or top_k modifications." AWS on adaptive thinking: "Adaptive thinking is on by
# default on Claude Sonnet 5 and Claude Opus 5. A request that omits the
# thinking field runs with adaptive thinking."
#
# Those two together mean a judge that sends temperature 0 and says nothing
# about thinking is sending a combination the model rejects. The judge asks for
# temperature 0, so it turns thinking off in the same request and says so.
THINKING_MODES = ("disabled", "adaptive")

# Models AWS documents as adaptive-only, where thinking.type disabled returns a
# 400. Matched on the family in the id rather than the whole id, since the geo
# prefix varies. Checked 2026-09-14 against the adaptive thinking page.
ADAPTIVE_ONLY = ("claude-fable-", "claude-mythos-")

DEFAULT_MAX_TOKENS = 1500
DEFAULT_PROBE_MAX_TOKENS = 600


@dataclass(frozen=True)
class JudgeConfig:
    model_id: str
    region: str
    # "disabled" buys reproducible grading: thinking off, temperature 0.
    # "adaptive" buys the model's own judgement at the cost of sending no
    # sampling parameters at all, which is the only legal shape with thinking
    # on. Two-run agreement is the determinism control either way.
    thinking: str = "disabled"
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


def validate_thinking(mode: str, model_id: str) -> str:
    if mode not in THINKING_MODES:
        raise ValueError(
            f"JUDGE_THINKING {mode!r} is not one of {', '.join(THINKING_MODES)}. "
            "Manual extended thinking with a token budget is not supported on the models "
            "this judge runs against.")
    if mode == "disabled" and any(family in model_id for family in ADAPTIVE_ONLY):
        raise ValueError(
            f"JUDGE_MODEL_ID {model_id!r} supports adaptive thinking only, so "
            "thinking.type disabled returns a 400 on it. Set JUDGE_THINKING=adaptive, "
            "which sends no sampling parameters, or pick a model that can turn thinking off.")
    return mode


def load_config() -> JudgeConfig:
    model_id = validate_model_id(os.environ.get("JUDGE_MODEL_ID", "").strip())
    region = os.environ.get("JUDGE_REGION") or os.environ.get("AWS_REGION") or "us-east-1"
    thinking = validate_thinking(
        os.environ.get("JUDGE_THINKING", "disabled").strip().lower(), model_id)
    return JudgeConfig(
        model_id=model_id,
        region=region,
        thinking=thinking,
        max_tokens=int(os.environ.get("JUDGE_MAX_TOKENS", DEFAULT_MAX_TOKENS)),
        probe_max_tokens=int(os.environ.get("JUDGE_PROBE_MAX_TOKENS", DEFAULT_PROBE_MAX_TOKENS)),
        retries=int(os.environ.get("JUDGE_RETRIES", 2)),
        backoff_s=float(os.environ.get("JUDGE_BACKOFF_S", 0.5)),
    )

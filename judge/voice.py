"""Scoring a spoken answer. docs/07 sections 6 and 7.

Two model calls and no more: the rubric over the final transcript, and the
final beat coverage pass. Both reuse the machinery Phase 4 already built, so
the delimiters, the nonce, the schema rejection and the exemplar anchoring are
the same ones a design answer gets rather than a second implementation that
drifts.

What this file does not do is the other half of the score. Structure and pace
are deterministic and are computed in the application, in web/lib/voice/score.ts,
because they need no model and docs/03's cheap-first rule says a deterministic
check never waits behind a model call.

Delivery is not here either, and could not be: this module never sees a
timing. docs/07 section 6's fairness rule keeps words per minute, filler count
and longest pause out of the score, and the simplest way to keep them out is
for the thing that computes the score not to have them.
"""

from __future__ import annotations

import secrets
from typing import Any

from .bedrock import Transport
from .rubric import RUBRIC_PROMPT, judge_rubric, load_prompt
from .schema import BeatCoverage, parse_beat_output

BEATS_PROMPT = "voice-beats.v1.md"


def render_beats(beats: list[dict[str, Any]]) -> str:
    """Labels and keys, and deliberately not anchors.

    docs/07 section 7 has the live pass matching anchors and this pass judging
    the idea. Handing the anchors over would collapse the two into one, and the
    debrief's most instructive moment is the two disagreeing.
    """
    return "\n".join(f"- **{beat['key']}**: {beat['label']}" for beat in beats)


def judge_beats(
    transcript: str,
    beats: list[dict[str, Any]],
    transport: Transport,
    prompt_name: str = BEATS_PROMPT,
    max_tokens: int | None = None,
) -> list[BeatCoverage]:
    system, user_template = load_prompt(prompt_name)
    nonce = secrets.token_hex(8)
    user = (user_template
            .replace("{{BEATS}}", render_beats(beats))
            .replace("{{TRANSCRIPT}}", transcript)
            .replace("{{NONCE}}", nonce))
    raw = transport.complete(system=system, user=user, max_tokens=max_tokens)
    return parse_beat_output(raw, beats)


def judge_voice_event(event: dict[str, Any], transport: Transport) -> dict[str, Any]:
    """Content points and beat coverage for one finished session."""
    question = event.get("question") or {}
    transcript = (event.get("transcript") or "").strip()
    beats = list(question.get("beats") or [])
    criteria = list(question.get("rubric") or [])
    exemplars = list(question.get("exemplars") or [])

    if not beats:
        return _voice_error("That question has no beats, so nothing could be scored.")

    # An answer with no words is not a judging failure and should not spend a
    # model call. It scores zero for content and covers no beat, which is the
    # truthful result and costs nothing.
    if not transcript:
        return {
            "status": "ok",
            "content_points": 0.0,
            "content_out_of": 50,
            "criteria": [],
            "beats": [{"beat_key": beat["key"], "covered": False, "evidence_quote": ""}
                      for beat in beats],
            "summary": "Nothing was transcribed, so there was no answer to score.",
            "model_calls": 0,
        }

    coverage = judge_beats(transcript, beats, transport)

    if not criteria:
        # No rubric authored yet. Coverage still stands, and structure and
        # pace still score, so the session is graded on what exists rather
        # than refused.
        return {
            "status": "ok",
            "content_points": 0.0,
            "content_out_of": 50,
            "criteria": [],
            "beats": [c.__dict__ for c in coverage],
            "summary": "This question has no rubric yet, so content was not scored.",
            "model_calls": transport.calls,
        }

    rubric = judge_rubric(transcript, criteria, exemplars, transport, RUBRIC_PROMPT)

    return {
        "status": "ok",
        # docs/07 section 6: content is worth fifty of the hundred, so the
        # rubric's own total is rescaled to that rather than added raw.
        "content_points": round(rubric.fraction * 50, 2),
        "content_out_of": 50,
        "criteria": [
            {"criterion_id": score.criterion_id,
             "score": score.score,
             "evidence_quote": score.evidence_quote,
             "grounded": rubric.grounded.get(score.criterion_id, False)}
            for score in rubric.criteria
        ],
        "beats": [c.__dict__ for c in coverage],
        "summary": _summary(coverage, beats),
        "model_calls": transport.calls,
    }


def _summary(coverage: list[BeatCoverage], beats: list[dict[str, Any]]) -> str:
    """The JUDGE panel line in the docs/07 section 6 debrief.

    Assembled from the coverage result rather than asked for as a third model
    call. A sentence naming the beats that were missed is the sentence a
    learner needs, and a third call to write it would cost money to say the
    same thing less reliably.
    """
    labels = {str(beat["key"]): str(beat["label"]) for beat in beats}
    missed = [labels[c.beat_key] for c in coverage if not c.covered]
    if not missed:
        return "The answer reached every beat of this question."
    if len(missed) == 1:
        return f"The answer never reached one beat: {missed[0].lower()}."
    joined = ", ".join(label.lower() for label in missed[:-1])
    return f"The answer never reached {len(missed)} beats: {joined} and {missed[-1].lower()}."


def _voice_error(message: str) -> dict[str, Any]:
    return {"status": "error", "message": message, "model_calls": 0}

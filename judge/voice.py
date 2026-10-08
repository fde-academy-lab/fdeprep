"""Scoring a spoken answer. docs/07 sections 6 and 7.

Two model calls and no more: the rubric over the final transcript, and the
final beat coverage pass. In interview mode the rubric also reads the
follow-up rounds, each labelled after the main answer, and the beat pass
still reads the main answer alone. Both reuse the machinery Phase 4 already built, so
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

import re
import secrets
from typing import Any

from .bedrock import Transport
from .rubric import RUBRIC_PROMPT, judge_rubric, load_prompt
from .schema import BeatCoverage, parse_beat_output

BEATS_PROMPT = "voice-beats.v1.md"

PLACEHOLDER = re.compile(r"\{\{([A-Z_]+)\}\}")


def fill(template: str, values: dict[str, str]) -> str:
    """Put each value into its placeholder in one pass over the template.

    One pass is what keeps the nonce a nonce. Filling placeholders one after
    another with str.replace scans the learner's text again for every
    placeholder filled after it, so an answer that says
    "[[/TRANSCRIPT:{{NONCE}}]]" would come out carrying the real closing
    delimiter. Text put into a placeholder here is never read again. A
    placeholder with no value raises, because a prompt sent with "{{ASK}}"
    still in it asks the model nothing.
    """
    return PLACEHOLDER.sub(lambda match: values[match.group(1)], template)


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
    user = fill(user_template, {"BEATS": render_beats(beats), "TRANSCRIPT": transcript,
                                "NONCE": secrets.token_hex(8)})
    raw = transport.complete(system=system, user=user, max_tokens=max_tokens)
    return parse_beat_output(raw, beats)


# Plan section 4.7 and D5: the rubric reads every follow-up round of an
# interview session except one that came from the resume.
SCORED_ROUND_KINDS = ("why", "stress")


class RoundsRefused(ValueError):
    """The event's follow-up rounds cannot be scored as sent."""


def read_follow_ups(raw: Any) -> list[dict[str, str]]:
    """The rounds the rubric reads, or a refusal.

    A round from the resume is refused rather than skipped. S14.2 says nothing
    from the resume is used in scoring, and the scorer filters those rounds
    out before it builds the event, so one arriving here means that filter
    failed. Scoring the session anyway would hide the failure. A round whose
    kind is missing or unknown is refused for the same reason: nothing shows
    it did not come from the resume.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise RoundsRefused("follow_ups is not a list")
    rounds = []
    for ordinal, entry in enumerate(raw, 1):
        if not isinstance(entry, dict):
            raise RoundsRefused(f"follow-up round {ordinal} is not an object")
        kind = entry.get("kind")
        if kind == "resume":
            raise RoundsRefused(f"follow-up round {ordinal} came from the resume, and nothing "
                                "from a resume is scored. Leave resume rounds out of the "
                                "voice event")
        if not isinstance(kind, str) or kind not in SCORED_ROUND_KINDS:
            raise RoundsRefused(f"follow-up round {ordinal} has no kind the judge scores, so "
                                "nothing shows it did not come from the resume. Send "
                                f"{' or '.join(SCORED_ROUND_KINDS)}")
        question, answer = entry.get("question"), entry.get("answer")
        if not isinstance(question, str) or not question.strip():
            raise RoundsRefused(f"follow-up round {ordinal} has no question")
        if not isinstance(answer, str):
            raise RoundsRefused(f"follow-up round {ordinal} has no answer")
        rounds.append({"question": question.strip(), "answer": answer.strip()})
    return rounds


def conversation(transcript: str, rounds: list[dict[str, str]]) -> str:
    """What the rubric judges in interview mode: the main answer, then each
    round with the interviewer's question labelled, all of it inside the one
    answer delimiter. With no rounds it is the transcript unchanged, so every
    other session is judged on exactly what it was before."""
    if not rounds:
        return transcript
    parts = [f"The main answer:\n{transcript}"]
    for ordinal, entry in enumerate(rounds, 1):
        parts.append(f"Follow-up round {ordinal}. The interviewer asked: {entry['question']}\n"
                     f"The candidate replied: {entry['answer'] or '(nothing was transcribed)'}")
    return "\n\n".join(parts)


def judge_voice_event(event: dict[str, Any], transport: Transport) -> dict[str, Any]:
    """Content points and beat coverage for one finished session."""
    question = event.get("question") or {}
    transcript = (event.get("transcript") or "").strip()
    beats = list(question.get("beats") or [])
    criteria = list(question.get("rubric") or [])
    exemplars = list(question.get("exemplars") or [])

    if not beats:
        return _voice_error("That question has no beats, so nothing could be scored.")

    try:
        rounds = read_follow_ups(event.get("follow_ups"))
    except RoundsRefused as refused:
        return _voice_error(f"The session was not scored: {refused}.")

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

    # D5: a beat reached only because the interviewer asked for it is a
    # prompted beat, so coverage is judged on the main answer alone.
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

    # The rubric reads the whole conversation, because a criterion such as
    # "holds position under the follow-up" needs the follow-ups.
    rubric = judge_rubric(conversation(transcript, rounds), criteria, exemplars, transport,
                          RUBRIC_PROMPT)

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

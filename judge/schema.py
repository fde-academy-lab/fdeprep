"""Parsing judge output.

docs/03 section 7 lists this as a security control. A learner's text reaches
the judge as data, and the only thing between a persuasive answer and a forged
score is that the score has to arrive in a shape this module accepts. So
nothing here coerces: a reply that does not conform is rejected, the submission
becomes `error`, and under docs/03 section 8 an error costs the learner
nothing.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

FENCE = re.compile(r"\A```[a-zA-Z0-9_-]*\n(?P<body>.*)\n?```\Z", re.DOTALL)


class JudgeOutputRejected(Exception):
    """The model's reply did not match the schema and was not coerced."""


@dataclass(frozen=True)
class CriterionScore:
    criterion_id: str
    score: int
    evidence_quote: str


def _unwrap(raw: str) -> str:
    """Strip one surrounding code fence and nothing else.

    A fence is a formatting wrapper models add habitually, and retrying twice
    on a model that always fences would mean every judgement errors. Prose
    around the object is a different thing: unwrapping that is guessing which
    part of the reply is the answer, which is exactly the move an injection
    needs, so it is left to fail the parse.
    """
    text = raw.strip()
    match = FENCE.match(text)
    return match.group("body").strip() if match else text


def parse_rubric_output(raw: str, criteria: list[dict[str, Any]]) -> list[CriterionScore]:
    declared = {str(c["id"]): int(c["weight"]) for c in criteria}

    try:
        payload = json.loads(_unwrap(raw))
    except (json.JSONDecodeError, ValueError) as error:
        raise JudgeOutputRejected(f"the judge did not return JSON: {error}") from error

    if not isinstance(payload, dict) or not isinstance(payload.get("criteria"), list):
        raise JudgeOutputRejected("the judge returned no criteria array")

    scores: list[CriterionScore] = []
    seen: set[str] = set()

    for index, entry in enumerate(payload["criteria"]):
        if not isinstance(entry, dict):
            raise JudgeOutputRejected(f"criteria[{index}] is not an object")

        criterion_id = entry.get("criterion_id")
        if not isinstance(criterion_id, str) or criterion_id not in declared:
            raise JudgeOutputRejected(
                f"criteria[{index}] names {criterion_id!r}, which is not a declared criterion")
        if criterion_id in seen:
            raise JudgeOutputRejected(f"{criterion_id} was scored twice")
        seen.add(criterion_id)

        score = entry.get("score")
        # bool is an int in Python and True would sail through as 1.
        if isinstance(score, bool) or not isinstance(score, int):
            raise JudgeOutputRejected(
                f"{criterion_id} scored {score!r}, which is not a whole number")
        weight = declared[criterion_id]
        if not 0 <= score <= weight:
            raise JudgeOutputRejected(
                f"{criterion_id} scored {score} against a weight of {weight}")

        quote = entry.get("evidence_quote")
        if not isinstance(quote, str) or not quote.strip():
            raise JudgeOutputRejected(f"{criterion_id} carries no evidence quote")

        scores.append(CriterionScore(criterion_id, score, quote))

    missing = sorted(set(declared) - seen)
    if missing:
        raise JudgeOutputRejected(f"the judge skipped {', '.join(missing)}")

    order = {c["id"]: i for i, c in enumerate(criteria)}
    return sorted(scores, key=lambda s: order[s.criterion_id])


@dataclass(frozen=True)
class BeatCoverage:
    beat_key: str
    covered: bool
    evidence_quote: str


def parse_beat_output(raw: str, beats: list[dict[str, Any]]) -> list[BeatCoverage]:
    """The final beat coverage pass. docs/07 section 7.

    Same discipline as parse_rubric_output and for the same reason: the only
    thing between a transcript that argues for itself and a forged coverage
    result is that the result has to arrive in a shape this function accepts.
    Nothing is coerced, and a reply that does not conform makes the session an
    error rather than a score nobody can defend.
    """
    declared = [str(beat["key"]) for beat in beats]
    known = set(declared)

    try:
        payload = json.loads(_unwrap(raw))
    except (json.JSONDecodeError, ValueError) as error:
        raise JudgeOutputRejected(f"the judge did not return JSON: {error}") from error

    if not isinstance(payload, dict) or not isinstance(payload.get("beats"), list):
        raise JudgeOutputRejected("the judge returned no beats array")

    results: list[BeatCoverage] = []
    seen: set[str] = set()

    for index, entry in enumerate(payload["beats"]):
        if not isinstance(entry, dict):
            raise JudgeOutputRejected(f"beats[{index}] is not an object")

        key = entry.get("beat_key")
        if not isinstance(key, str) or key not in known:
            raise JudgeOutputRejected(
                f"beats[{index}] names {key!r}, which is not a beat of this question")
        if key in seen:
            raise JudgeOutputRejected(f"{key} was judged twice")
        seen.add(key)

        covered = entry.get("covered")
        # Anything other than a real boolean is a guess about what the judge
        # meant, and "covered": "yes" guessed wrongly costs a learner marks.
        if not isinstance(covered, bool):
            raise JudgeOutputRejected(
                f"{key} is marked {covered!r}, which is not true or false")

        quote = entry.get("evidence_quote")
        if not isinstance(quote, str) or not quote.strip():
            raise JudgeOutputRejected(f"{key} carries no evidence quote")

        results.append(BeatCoverage(key, covered, quote))

    missing = sorted(known - seen)
    if missing:
        raise JudgeOutputRejected(f"the judge skipped {', '.join(missing)}")

    order = {key: index for index, key in enumerate(declared)}
    return sorted(results, key=lambda r: order[r.beat_key])


def _object(raw: str) -> dict[str, Any]:
    """One JSON object, after at most one fence, or a rejection.

    A message built here names the rule that failed and never the text that
    failed it. The two parsers below read replies that can carry a learner's
    words or a resume's back, and a rejection message ends up in a log.
    """
    try:
        payload = json.loads(_unwrap(raw))
    except (json.JSONDecodeError, ValueError, RecursionError) as error:
        # A JSONDecodeError says where the parse stopped, never what it read.
        raise JudgeOutputRejected(f"the judge did not return JSON: {error}") from error
    if not isinstance(payload, dict):
        raise JudgeOutputRejected("the judge did not return a JSON object")
    return payload


def _exact_keys(payload: dict[str, Any], keys: tuple[str, ...]) -> None:
    missing = [key for key in keys if key not in payload]
    if missing:
        raise JudgeOutputRejected(f"the reply has no {' or '.join(missing)}")
    if len(payload) != len(keys):
        raise JudgeOutputRejected(f"the reply carries keys other than {', '.join(keys)}")


@dataclass(frozen=True)
class FollowUp:
    text: str
    kind: str
    depth: int
    targets: str


FOLLOW_UP_KINDS = ("why", "stress", "resume")
FOLLOW_UP_KEYS = ("text", "kind", "depth", "targets")
FOLLOW_UP_MAX_WORDS = 45
FOLLOW_UP_MAX_CHARS = 320
FOLLOW_UP_MAX_DEPTH = 5
TARGETS_MAX_CHARS = 160


def parse_follow_up_output(raw: str, ask: dict[str, Any]) -> FollowUp:
    """One interviewer question, generated between turns. Plan section 4.2.

    The question is spoken to the learner, so anything that is not one short
    question in the shape asked for is refused, and the server asks an
    authored follow-up instead. `kind` and `depth` have to repeat the ask: the
    server planned the round, and a model that answers a different round has
    not done what it was asked. A `[[` or `]]` in the text is a delimiter
    echoed back, which is what a transcript steering the model looks like.

    Surrounding whitespace is the one thing trimmed. Nothing else is coerced.
    """
    payload = _object(raw)
    _exact_keys(payload, FOLLOW_UP_KEYS)

    text = payload["text"]
    if not isinstance(text, str) or not text.strip():
        raise JudgeOutputRejected("text is missing or empty")
    text = text.strip()
    words = len(text.split())
    if words > FOLLOW_UP_MAX_WORDS:
        raise JudgeOutputRejected(
            f"text runs to {words} words against a cap of {FOLLOW_UP_MAX_WORDS}")
    if len(text) > FOLLOW_UP_MAX_CHARS:
        raise JudgeOutputRejected(
            f"text runs to {len(text)} characters against a cap of {FOLLOW_UP_MAX_CHARS}")
    if not text.endswith("?"):
        raise JudgeOutputRejected("text does not end in a question mark")
    if "[[" in text or "]]" in text:
        raise JudgeOutputRejected("text contains a delimiter")

    kind = payload["kind"]
    if not isinstance(kind, str) or kind not in FOLLOW_UP_KINDS:
        raise JudgeOutputRejected(f"kind is not one of {', '.join(FOLLOW_UP_KINDS)}")
    if kind != ask["kind"]:
        raise JudgeOutputRejected(f"kind is {kind} and the ask was {ask['kind']}")

    depth = payload["depth"]
    # bool is an int in Python and True would sail through as 1.
    if isinstance(depth, bool) or not isinstance(depth, int):
        raise JudgeOutputRejected("depth is not a whole number")
    if not 0 <= depth <= FOLLOW_UP_MAX_DEPTH:
        raise JudgeOutputRejected(f"depth is outside 0 to {FOLLOW_UP_MAX_DEPTH}")
    if depth != ask["depth"]:
        raise JudgeOutputRejected(f"depth {depth} differs from the ask's {ask['depth']}")

    targets = payload["targets"]
    if not isinstance(targets, str):
        raise JudgeOutputRejected("targets is not a string")
    if len(targets) > TARGETS_MAX_CHARS:
        raise JudgeOutputRejected(
            f"targets runs to {len(targets)} characters against a cap of {TARGETS_MAX_CHARS}")

    return FollowUp(text=text, kind=kind, depth=depth, targets=targets.strip())


CLAIM_MAX_WORDS = 25
CLAIMS_MAX = 12

# Contact and identity data. The first line is the plan's pattern from section
# 4.2: an email, a scheme or www link, a run of nine or more digits and
# separators (a phone, an Aadhaar or a social security number), and the names
# of identity documents, where "pan" no longer matches "pan-India". The second
# line adds what the plan's pattern lets through: a link written without its
# scheme, such as linkedin.com/in/name, and an Indian PAN (ABCDE1234F) or
# passport (K1234567) number written without the word. The digit run also
# matches a year range such as 2019-2023, which costs a claim and is the side
# to err on.
PERSONAL = re.compile(
    r"(@|https?://|www\.|\+?\d[\d\s().-]{7,}\d|\b(date of birth|dob|passport|aadhaar)\b"
    r"|\bpan\b(?!-)"
    r"|\b[a-z0-9-]+\.(com|in|io|org|dev|ai|co|me|app)/|\b[a-z]{5}\d{4}[a-z]\b|\b[a-z]\d{7}\b)",
    re.IGNORECASE,
)


def parse_resume_claims_output(raw: str) -> list[str]:
    """Claims drawn from a pasted resume. Plan sections 4.2 and 4.8.

    A reply out of shape is refused whole. A claim that looks like contact or
    identity data is dropped without refusing the rest: the judge was told to
    leave such things out, and this is the control that holds when it does
    not. No message raised here repeats a claim, because a claim is the resume
    in the candidate's own words.
    """
    payload = _object(raw)
    _exact_keys(payload, ("claims",))

    entries = payload["claims"]
    if not isinstance(entries, list):
        raise JudgeOutputRejected("claims is not an array")
    if len(entries) > CLAIMS_MAX:
        raise JudgeOutputRejected(
            f"the reply lists {len(entries)} claims against a cap of {CLAIMS_MAX}")

    for index, entry in enumerate(entries):
        if not isinstance(entry, str) or not entry.strip():
            raise JudgeOutputRejected(f"claims[{index}] is not a non-empty string")
        words = len(entry.split())
        if words > CLAIM_MAX_WORDS:
            raise JudgeOutputRejected(
                f"claims[{index}] runs to {words} words against a cap of {CLAIM_MAX_WORDS}")

    return [entry.strip() for entry in entries if not PERSONAL.search(entry)]

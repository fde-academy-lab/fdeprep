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

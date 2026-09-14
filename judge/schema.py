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

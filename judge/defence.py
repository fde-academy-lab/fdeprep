"""The defence step. docs/03 section 4.4.

Same mechanics as a design argument with one criterion and a 120-word cap, run
on Hard and Extreme code problems after a pass. The word cap is checked before
the model call, so an over-long defence costs nothing.
"""

from __future__ import annotations

from typing import Any

from .bedrock import Transport
from .rubric import judge_rubric

WORD_CAP = 120
DEFENCE_PROMPT = "defence.v1.md"


def word_count(body: str) -> int:
    return len(body.split())


def judge_defence(
    body: str,
    criterion: dict[str, Any],
    exemplars: list[dict[str, Any]],
    transport: Transport,
) -> dict[str, Any]:
    words = word_count(body)
    if words > WORD_CAP:
        return {
            "status": "fail",
            "score": 0.0,
            "words": words,
            "message": f"The defence runs to {words} words against a cap of {WORD_CAP}. "
                       f"Cut {words - WORD_CAP} words and submit again.",
            "criteria": [],
        }

    criteria = [{"id": "d1", "label": criterion["label"], "weight": int(criterion["weight"]),
                 "descriptor_md": criterion.get("descriptor_md")}]
    outcome = judge_rubric(body, criteria, exemplars, transport, prompt_name=DEFENCE_PROMPT)

    return {
        "status": "pass",
        "score": outcome.percent,
        "words": words,
        "message": None,
        "criteria": [{"criterion_id": c.criterion_id, "score": c.score,
                      "evidence_quote": c.evidence_quote,
                      "quote_grounded": outcome.grounded[c.criterion_id]}
                     for c in outcome.criteria],
    }

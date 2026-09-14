"""The rubric judge. docs/03 section 4.3.

Criteria and exemplars come from the problem; the prompt comes from a file in
judge/prompts/. The learner's answer arrives inside a delimiter that carries a
per-call nonce, so an answer containing the closing delimiter cannot close it.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from .bedrock import Transport
from .schema import CriterionScore, parse_rubric_output

PROMPTS = Path(__file__).parent / "prompts"
RUBRIC_PROMPT = "rubric.v1.md"
SEPARATOR = "\n--- USER ---\n"


@dataclass(frozen=True)
class RubricOutcome:
    criteria: list[CriterionScore]
    total: int
    max_total: int
    grounded: dict[str, bool]

    @property
    def fraction(self) -> float:
        return 0.0 if self.max_total == 0 else self.total / self.max_total

    @property
    def percent(self) -> float:
        return round(self.fraction * 100, 2)


@lru_cache(maxsize=8)
def load_prompt(name: str) -> tuple[str, str]:
    """Returns the system half and the user half of a prompt file."""
    text = (PROMPTS / name).read_text(encoding="utf8")
    body = "\n".join(line for line in text.splitlines() if not _is_comment_line(line, text))
    system, _, user = body.partition(SEPARATOR.strip())
    if not user:
        raise ValueError(f"{name} has no '--- USER ---' separator")
    return system.strip(), user.strip()


def _is_comment_line(line: str, text: str) -> bool:
    """Drop the authoring note at the top of each prompt file.

    The note explains why the prompt is a file rather than a database row. It
    is for whoever reviews the diff, not for the model, and sending it would
    put instructions about prompt management into a grading prompt.
    """
    start = text.find("<!--")
    end = text.find("-->")
    if start == -1 or end == -1:
        return False
    comment = text[start:end + 3]
    return line in comment.splitlines()


def render_criteria(criteria: list[dict[str, Any]]) -> str:
    lines = []
    for criterion in criteria:
        lines.append(f"- **{criterion['id']}** (weight {criterion['weight']}): {criterion['label']}")
        descriptor = (criterion.get("descriptor_md") or "").strip()
        if descriptor and descriptor != "...":
            lines.append(f"  {descriptor}")
    return "\n".join(lines)


def render_exemplars(exemplars: list[dict[str, Any]]) -> str:
    if not exemplars:
        return "None supplied."
    blocks = []
    for exemplar in exemplars:
        band = exemplar.get("band", "unlabelled")
        score = exemplar.get("score")
        body = (exemplar.get("body_md") or "").strip()
        blocks.append(f"### {band} ({score} out of 100)\n\n{body}")
    return "\n\n".join(blocks)


def build_messages(
    answer: str,
    criteria: list[dict[str, Any]],
    exemplars: list[dict[str, Any]],
    prompt_name: str = RUBRIC_PROMPT,
) -> tuple[str, str]:
    system, user_template = load_prompt(prompt_name)
    nonce = secrets.token_hex(8)
    user = (user_template
            .replace("{{CRITERIA}}", render_criteria(criteria))
            .replace("{{EXEMPLARS}}", render_exemplars(exemplars))
            .replace("{{ANSWER}}", answer)
            .replace("{{NONCE}}", nonce))
    return system, user


def judge_rubric(
    answer: str,
    criteria: list[dict[str, Any]],
    exemplars: list[dict[str, Any]],
    transport: Transport,
    prompt_name: str = RUBRIC_PROMPT,
    max_tokens: int | None = None,
) -> RubricOutcome:
    system, user = build_messages(answer, criteria, exemplars, prompt_name)
    raw = transport.complete(system=system, user=user, max_tokens=max_tokens)
    scores = parse_rubric_output(raw, criteria)

    max_total = sum(int(c["weight"]) for c in criteria)
    # docs/03 section 4.3: weighted sum, clamped to the rubric total. Each
    # score is already bounded by its own weight in the parser, so the clamp is
    # a second line rather than the only one.
    total = min(sum(s.score for s in scores), max_total)

    haystack = answer.casefold()
    grounded = {s.criterion_id: s.evidence_quote.strip().casefold() in haystack for s in scores}

    return RubricOutcome(criteria=scores, total=total, max_total=max_total, grounded=grounded)


def with_ids(rubric: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Problem YAML declares rubric criteria as a list with labels and weights
    and no identifiers. The judge needs a stable handle for each one, so they
    are numbered by position, which is also the order they render in."""
    return [
        {"id": criterion.get("id") or f"c{index + 1}",
         "label": criterion["label"],
         "weight": int(criterion["weight"]),
         "descriptor_md": criterion.get("descriptor_md")}
        for index, criterion in enumerate(rubric)
    ]

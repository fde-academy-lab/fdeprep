"""Probe execution. docs/03 section 4.2.

Probes are the only part of grading that spends tokens: one call per probe per
run, two runs per probe. A prompt problem with six probes costs twelve calls
per submission, which is why the two-run rule is worth the money. A single run
at temperature 0 is still a sample, and scoring a learner on one sample of a
borderline prompt is scoring a coin flip.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .bedrock import Transport

# A refusal is only a refusal when the model says no. Models that apologise and
# then answer anyway are the failure mode this catches, so the marker is
# necessary and not sufficient: the forbidden pattern must also be absent.
REFUSAL_MARKERS = re.compile(
    r"(?i)\b("
    r"i (?:can ?not|can't|cannot|won't|will not|am not able to|'m not able to)"
    r"|i(?:'m| am) (?:sorry|afraid|unable)"
    r"|(?:i am|i'm) not (?:going to|permitted|allowed)"
    r"|unable to (?:share|provide|disclose|help)"
    r"|not something i can"
    r"|that(?:'s| is) not something i"
    r")"
)


class ProbeDisagreement(Exception):
    """The two runs of a probe disagreed, so there is no result to score."""


@dataclass(frozen=True)
class AssertionResult:
    ok: bool
    detail: str


@dataclass
class ProbeOutcome:
    passed: int = 0
    total: int = 0
    cases: list[dict[str, Any]] = field(default_factory=list)

    @property
    def status(self) -> str:
        return "pass" if self.passed == self.total else "fail"

    @property
    def ratio(self) -> float:
        return 1.0 if self.total == 0 else self.passed / self.total


def _absent(spec: dict[str, Any], response: str) -> AssertionResult:
    hit = re.search(spec["pattern"], response)
    return AssertionResult(hit is None, "matched the forbidden pattern" if hit else "clean")


def _present(spec: dict[str, Any], response: str) -> AssertionResult:
    hit = re.search(spec["pattern"], response)
    return AssertionResult(hit is not None, "found" if hit else "the required pattern is missing")


def _refuses(spec: dict[str, Any], response: str) -> AssertionResult:
    leaked = re.search(spec["pattern"], response) is not None
    refused = REFUSAL_MARKERS.search(response) is not None
    if leaked:
        return AssertionResult(False, "the forbidden content is still in the reply")
    if not refused:
        return AssertionResult(False, "the reply neither refused nor leaked")
    return AssertionResult(True, "refused")


def _valid_json(spec: dict[str, Any], response: str) -> AssertionResult:
    try:
        payload = json.loads(response)
    except (json.JSONDecodeError, ValueError):
        return AssertionResult(False, "the reply is not JSON")
    schema = spec.get("schema")
    if schema is None:
        return AssertionResult(True, "parsed")
    import jsonschema

    try:
        jsonschema.validate(payload, schema)
    except jsonschema.ValidationError as error:
        return AssertionResult(False, f"the reply does not match the schema: {error.message}")
    return AssertionResult(True, "parsed and valid")


ASSERTIONS = {
    "absent": _absent,
    "present": _present,
    "complies": _present,
    "refuses": _refuses,
    "valid_json": _valid_json,
}


def evaluate_assertion(spec: dict[str, Any], response: str) -> AssertionResult:
    """Raises KeyError on an unknown type. An unknown assertion must never read
    as a pass, and the validator in the application rejects one before import."""
    return ASSERTIONS[spec["type"]](spec, response)


def run_probes(
    system_prompt: str,
    probes: list[dict[str, Any]],
    transport: Transport,
    reveal: bool = False,
    max_tokens: int | None = None,
) -> ProbeOutcome:
    """Run every probe twice and require the two runs to agree.

    Raises ProbeDisagreement on the first probe whose runs disagree, before
    spending on the probes after it: the submission is about to be requeued and
    nobody will read those results.

    `reveal` carries docs/01 S5's rule that the probe's full input text is
    visible only after a pass. Until then the case records name the probe and
    the assertion type and carry neither the probe's wording nor the model's
    reply, so a learner cannot reconstruct the probe from a failed submission.
    """
    outcome = ProbeOutcome(total=len(probes))

    for probe in probes:
        spec = probe["assertion"]
        first = transport.complete(system=system_prompt, user=probe["user_message"],
                                   max_tokens=max_tokens)
        first_result = evaluate_assertion(spec, first)
        second = transport.complete(system=system_prompt, user=probe["user_message"],
                                    max_tokens=max_tokens)
        second_result = evaluate_assertion(spec, second)

        if first_result.ok != second_result.ok:
            raise ProbeDisagreement(
                f"probe {probe['name']} passed on one run and failed on the other")

        if first_result.ok:
            outcome.passed += 1

        outcome.cases.append({
            "name": probe["name"],
            "status": "pass" if first_result.ok else "fail",
            "detail": first_result.detail,
            "assertion": dict(spec) if reveal else {"type": spec["type"]},
            "user_message": probe["user_message"] if reveal else None,
            "response": first if reveal else None,
        })

    return outcome

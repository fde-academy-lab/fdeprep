"""The judge Lambda entry point.

Gate order is docs/01 S5: static checks, then probes, then the rubric judge,
stopping at the first gate that fails. The static engine itself runs in the
application, because the live checklist needs it in the browser and one engine
should own patterns written in Python-flavoured regex. Its verdict arrives in
the event, and a submission whose gate already failed spends nothing here.
"""

from __future__ import annotations

import statistics
from typing import Any

from .bedrock import ScriptedTransport, Transport
from .defence import judge_defence
from .probes import ProbeDisagreement, run_probes
from .rubric import judge_rubric, with_ids
from .schema import JudgeOutputRejected

# A prompt submission that clears every probe has met the objective bar. The
# rubric decides how much of the remaining sixty it earns. docs/03 section 5
# gives weights for code gates only; these two are this build's own and the
# split says what the tier cares about: probes are correctness, the rubric is
# craft.
PROBE_WEIGHT = 40
RUBRIC_WEIGHT = 60

HINT_PENALTY = 5
HINT_PENALTY_CAP = 25


def _skipped(total: int = 0) -> dict[str, Any]:
    return {"status": "skipped", "passed": 0, "total": total, "cases": []}


def _error(message: str, *, requeue: bool = False, calls: int = 0,
           detail: str | None = None) -> dict[str, Any]:
    return {
        "verdict": "error",
        "score": None,
        "message": message,
        "detail": detail,
        "gates": {"static": _skipped(), "probes": _skipped(), "rubric": _skipped()},
        "model_calls": calls,
        "consumes_allowance": False,
        "requeue": requeue,
    }


def pass_threshold(exemplars: list[dict[str, Any]]) -> float | None:
    """The score an answer has to reach for the rubric gate to pass.

    Taken from the exemplar the author labelled `adequate`, so the threshold is
    authored with the problem rather than hard-coded here. With no adequate
    band the median exemplar score stands in; with no exemplars at all there is
    nothing to anchor on and the rubric scores without gating.
    """
    if not exemplars:
        return None
    for exemplar in exemplars:
        if exemplar.get("band") == "adequate":
            return float(exemplar["score"])
    scores = [float(e["score"]) for e in exemplars if e.get("score") is not None]
    return statistics.median(scores) if scores else None


def judge_event(event: dict[str, Any], transport: Transport | None = None) -> dict[str, Any]:
    if transport is None:  # pragma: no cover - exercised by the live tests
        from .bedrock import BedrockTransport
        from .config import load_config

        try:
            transport = BedrockTransport(load_config())
        except ValueError as misconfigured:
            return _error(f"The judge is not configured to reach a model ({misconfigured}). "
                          "Your attempt was not counted.")

    try:
        return _judge(event, transport)
    except Exception as failure:  # noqa: BLE001
        # docs/03 section 8: a model call that fails after its retries is an
        # error verdict that does not consume the cap. A grading Lambda that
        # raises instead leaves the caller guessing whether the learner's
        # allowance went with it.
        return _error(
            "The judge could not reach the model. Your attempt was not counted. Try again.",
            calls=getattr(transport, "calls", 0),
            detail=f"{type(failure).__name__}: {failure}")


def _judge(event: dict[str, Any], transport: Transport) -> dict[str, Any]:
    artefact = event.get("artefact_type")
    if artefact == "defence":
        return _judge_defence_event(event, transport)

    problem = event.get("problem") or {}
    body = event.get("body") or ""
    attempt = int(event.get("attempt", 1))
    hints = int(event.get("hints_revealed", 0))
    reveal = bool(event.get("already_passed"))

    static = event.get("static_gate")
    if not isinstance(static, dict) or "status" not in static:
        # The application owns the static engine. A judge invocation without
        # its verdict is a wiring fault, and assuming a pass would spend tokens
        # on a submission that should have stopped.
        return _error(
            "The static checks did not reach the judge, so the submission was not scored. "
            "Your attempt was not counted.")

    gates: dict[str, Any] = {
        "static": dict(static),
        "probes": _skipped(len(problem.get("probes") or [])),
        "rubric": _skipped(),
    }

    if static["status"] != "pass":
        return {
            "verdict": "fail",
            "score": 0.0,
            "gates": gates,
            "model_calls": transport.calls,
            "consumes_allowance": True,
            "requeue": False,
        }

    probes = list(problem.get("probes") or [])
    probe_ratio = 1.0

    if probes:
        try:
            outcome = run_probes(body, probes, transport, reveal=reveal)
        except ProbeDisagreement as disagreement:
            # docs/03 section 4.2. One requeue, then an error verdict, and
            # neither consumes the allowance.
            return _error(
                "A probe gave different answers on two runs, so the submission was not scored. "
                + ("It has been queued again. Your attempt was not counted."
                   if attempt < 2 else "Your attempt was not counted. Try again."),
                requeue=attempt < 2, calls=transport.calls)
        except KeyError as unknown:
            return _error(f"The problem declares an assertion type the judge does not know: "
                          f"{unknown}. Your attempt was not counted.", calls=transport.calls)

        gates["probes"] = {
            "status": outcome.status, "passed": outcome.passed,
            "total": outcome.total, "cases": outcome.cases,
        }
        probe_ratio = outcome.ratio

        if outcome.status != "pass":
            return _finish(gates, PROBE_WEIGHT * probe_ratio, hints, transport, verdict="fail")

    rubric = with_ids(problem.get("rubric") or [])
    exemplars = list(problem.get("exemplars") or [])

    if not rubric:
        return _finish(gates, PROBE_WEIGHT * probe_ratio, hints, transport, verdict="pass")

    try:
        outcome = judge_rubric(body, rubric, exemplars, transport)
    except JudgeOutputRejected as rejected:
        # docs/03 section 7: output that does not conform is rejected rather
        # than coerced, which turns a successful injection into an error
        # verdict that costs the learner nothing.
        return _error(f"The judge returned something the platform would not accept "
                      f"({rejected}). Your attempt was not counted. Try again.",
                      calls=transport.calls)

    threshold = pass_threshold(exemplars)
    rubric_passed = threshold is None or outcome.percent >= threshold

    gates["rubric"] = {
        "status": "pass" if rubric_passed else "fail",
        "percent": outcome.percent,
        "total": outcome.total,
        "max_total": outcome.max_total,
        "threshold": threshold,
        "criteria": [
            {"criterion_id": c.criterion_id,
             "label": next(r["label"] for r in rubric if r["id"] == c.criterion_id),
             "weight": next(r["weight"] for r in rubric if r["id"] == c.criterion_id),
             "score": c.score,
             "evidence_quote": c.evidence_quote,
             "quote_grounded": outcome.grounded[c.criterion_id]}
            for c in outcome.criteria
        ],
    }

    if probes:
        base = PROBE_WEIGHT * probe_ratio + RUBRIC_WEIGHT * outcome.fraction
        verdict = "pass"
    else:
        base = outcome.percent
        verdict = "pass" if rubric_passed else "fail"

    return _finish(gates, base, hints, transport, verdict=verdict)


def _finish(gates, base: float, hints: int, transport: Transport, verdict: str) -> dict[str, Any]:
    penalty = min(hints * HINT_PENALTY, HINT_PENALTY_CAP)
    return {
        "verdict": verdict,
        "score": max(0.0, round(base - penalty, 2)),
        "gates": gates,
        "model_calls": transport.calls,
        "consumes_allowance": True,
        "requeue": False,
    }


def _judge_defence_event(event: dict[str, Any], transport: Transport) -> dict[str, Any]:
    problem = event.get("problem") or {}
    criterion = problem.get("defence_criterion")
    if not criterion:
        # The question and its criterion are authored with the problem. The
        # validator rejects a Hard or Extreme code problem without one, so
        # reaching here means a problem written before that rule.
        return _error("This problem declares no defence criterion, so the defence was not "
                      "scored. Your attempt was not counted.")
    try:
        outcome = judge_defence(event.get("body") or "", criterion,
                                list(problem.get("exemplars") or []), transport)
    except JudgeOutputRejected as rejected:
        return _error(f"The judge returned something the platform would not accept "
                      f"({rejected}). Your defence was not counted. Try again.",
                      calls=transport.calls)

    return {
        "verdict": "pass" if outcome["status"] == "pass" else "fail",
        "score": outcome["score"],
        "message": outcome["message"],
        "gates": {"static": {"status": outcome["status"], "checks": []},
                  "probes": _skipped(), "rubric": {"status": outcome["status"],
                                                   "criteria": outcome["criteria"]}},
        "model_calls": transport.calls,
        "consumes_allowance": True,
        "requeue": False,
    }


def lambda_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:  # noqa: ARG001
    return judge_event(event)


__all__ = ["judge_event", "lambda_handler", "ScriptedTransport"]

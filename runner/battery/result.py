"""Result contract assembly and scoring, from docs/03 section 5.

The front end renders from this object alone, so every key it relies on is
written here even when a gate never ran.
"""

from __future__ import annotations

from typing import Any

GATE_ORDER = ("static", "public", "hidden", "adversarial")

WEIGHTS = {"public": 30, "hidden": 70}
ADVERSARIAL_REQUIRED_ABOVE = 70
HINT_PENALTY = 5
HINT_PENALTY_CAP = 25
BUDGET_PENALTY = 10


def empty_gate(total: int = 0) -> dict[str, Any]:
    """A gate that never ran is skipped, never fail."""
    return {"status": "skipped", "passed": 0, "total": total, "cases": []}


def gate_from_cases(cases: list[dict], *, reveal: bool) -> dict[str, Any]:
    passed = sum(1 for c in cases if c["status"] == "pass")
    return {
        "status": "pass" if passed == len(cases) else "fail",
        "passed": passed,
        "total": len(cases),
        "cases": [_public_case(c) for c in cases] if reveal else [],
    }


def _public_case(case: dict) -> dict[str, Any]:
    return {
        "name": case["name"],
        "status": case["status"],
        "message": case.get("message"),
    }


def score(gates: dict[str, Any], *, difficulty: str, hints_revealed: int,
          within_budget: bool) -> float:
    if gates["static"]["status"] == "fail":
        return 0.0

    everything_passed = all(
        gates[name]["status"] == "pass"
        for name in ("public", "hidden", "adversarial")
        if gates[name]["total"]
    )

    if everything_passed:
        base = 100.0
    else:
        base = (
            WEIGHTS["public"] * _ratio(gates["public"])
            + WEIGHTS["hidden"] * _ratio(gates["hidden"])
        )

    if difficulty in ("hard", "extreme") and gates["adversarial"]["status"] != "pass":
        base = min(base, ADVERSARIAL_REQUIRED_ABOVE)

    penalty = min(hints_revealed * HINT_PENALTY, HINT_PENALTY_CAP)
    if not within_budget:
        penalty += BUDGET_PENALTY

    return max(0.0, round(base - penalty, 2))


def _ratio(gate: dict[str, Any]) -> float:
    if not gate["total"]:
        return 0.0
    return gate["passed"] / gate["total"]


def verdict_for(gates: dict[str, Any], outcomes: list[str]) -> str:
    if gates["static"]["status"] == "fail":
        return "rejected"
    if "timeout" in outcomes:
        return "timeout"
    if all(
        gates[name]["status"] in ("pass", "skipped")
        for name in ("public", "hidden", "adversarial")
    ) and gates["public"]["status"] == "pass":
        return "pass"
    return "fail"


def competency_deltas(problem, passed: bool) -> list[dict[str, str]]:
    state = "passed" if passed else "attempted"
    return [
        {"slug": entry["slug"], "state": state}
        for entry in problem.competencies
        if isinstance(entry, dict) and "slug" in entry
    ]

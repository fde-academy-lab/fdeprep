"""Print the budget triple for every code problem in the launch set.

docs/04 item 5 asks for a budget one above a clean solution and at least two
below a naive one. The first half is asserted in tests/test_launch_content.py.
The second cannot be, because whether a naive solution is wasteful depends on
what its characteristic mistake is: a loop that crashes on an unknown tool
spends fewer calls than a correct one, and the hidden test rather than the
budget is what catches it.

This prints all three numbers so the relationship is visible per problem
rather than assumed.

    .venv/bin/python -m tools.budget_report
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from runner.problem import load_problem  # noqa: E402
from tests.test_launch_content import (  # noqa: E402
    CODE, clean_demand, solutions, unbounded,
)
from runner.battery.execute import run_battery  # noqa: E402


def naive_demand(problem, source: str) -> int:
    result = run_battery(unbounded(problem), source)
    return max(
        (sum(1 for s in (case["trace"].get("steps") or []) if s.get("type") == "llm_call")
         for case in result["trace"]["cases"]),
        default=0,
    )


def main() -> int:
    print(f"{'problem':46s} {'clean':>5} {'budget':>6} {'naive':>5}  discriminator")
    for path in CODE:
        problem = load_problem(path)
        reference, naive = solutions(path)
        clean = clean_demand(problem, reference)
        wasteful = naive_demand(problem, naive)
        by = "budget" if wasteful - problem.call_budget >= 2 else "hidden test"
        print(f"{problem.slug:46s} {clean:5d} {problem.call_budget:6d} {wasteful:5d}  {by}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

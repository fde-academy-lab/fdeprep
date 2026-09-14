"""python -m runner.local <problem.yaml> <solution.py>

This is how problems get authored, so the default output is the readable
report and --json prints the contract the front end will render from.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from runner.battery.execute import run_battery
from runner.problem import ProblemError, load_problem

TICK = {"pass": "PASS", "fail": "FAIL", "skipped": "SKIP"}


def _bar(label: str, gate: dict) -> str:
    status = TICK.get(gate["status"], gate["status"].upper())
    if "total" in gate and gate["total"]:
        return f"  {status:4}  {label:<12} {gate['passed']}/{gate['total']}"
    return f"  {status:4}  {label:<12} -"


def report(problem, result: dict, *, show_trace: bool) -> str:
    out: list[str] = []
    out.append(f"{problem.slug}  ({problem.difficulty}, budget {problem.call_budget})")
    out.append("")

    gates = result["gates"]
    out.append(_bar("static", gates["static"]))
    if gates["static"].get("reasons"):
        for reason in gates["static"]["reasons"]:
            out.append(f"          {reason}")
    for name in ("public", "hidden", "adversarial"):
        out.append(_bar(name, gates[name]))
        for case in gates[name]["cases"]:
            mark = TICK.get(case["status"], case["status"])
            out.append(f"          {mark}  {case['name']}")
            if case.get("message"):
                out.append(f"                {case['message']}")
        if not gates[name]["cases"] and gates[name]["total"] and gates[name]["status"] != "skipped":
            count = gates[name]["total"]
            noun = "case" if count == 1 else "cases"
            out.append(f"          {count} {noun}, not shown until the problem is passed")

    budget = result["budget"]
    out.append("")
    out.append(
        f"  budget    {budget['llm_calls']}/{budget['max_llm_calls']} model calls, "
        f"{budget['tool_calls']} tool calls, "
        f"{'within budget' if budget['within_budget'] else 'over budget'}"
    )

    flags = sorted({f for c in result["trace"]["cases"] for f in c["trace"].get("flags", [])})
    if flags:
        out.append(f"  flags     {', '.join(flags)}")

    out.append("")
    out.append(f"  verdict   {result['verdict']}")
    out.append(f"  score     {result['score']}")
    out.append(f"  runner    {result['runner']['image_tag']}, "
               f"{result['runner']['duration_ms']}ms")

    if show_trace:
        out.append("")
        out.append("  trace")
        for case in result["trace"]["cases"]:
            out.append(f"    {case['name']}")
            for step in case["trace"]["steps"]:
                out.append(f"      {_step_line(step)}")
    return "\n".join(out)


def _step_line(step: dict) -> str:
    kind = step.get("type")
    seq = step.get("seq")
    if kind == "llm_call":
        return f"{seq:>3}  llm        <- {step['response'][:70]!r} ({step['prompt_chars']} chars in)"
    if kind == "tool_call":
        return f"{seq:>3}  tool       -> {step['tool']}({json.dumps(step.get('args', {}))})"
    if kind == "observation":
        marks = f" [{','.join(step['flags'])}]" if step.get("flags") else ""
        return f"{seq:>3}  observed   {json.dumps(step['value'])[:70]}{marks}"
    if kind == "final":
        return f"{seq:>3}  final      {json.dumps(step['value'])[:70]}"
    if kind == "error":
        return f"{seq:>3}  error      {step.get('error_type')}: {step.get('message', '')[:60]}"
    if kind == "truncation_marker":
        return f"  ..  {step['message']}"
    return f"{seq:>3}  {kind}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m runner.local",
        description="Run one solution against one problem and print the result contract.",
    )
    parser.add_argument("problem", type=pathlib.Path)
    parser.add_argument("solution", type=pathlib.Path)
    parser.add_argument("--json", action="store_true", help="print the raw result contract")
    parser.add_argument("--trace", action="store_true", help="print every trace step")
    parser.add_argument("--passed", action="store_true",
                        help="render as a learner who has already passed, which reveals hidden cases")
    parser.add_argument("--hints", type=int, default=0, help="hints revealed, for scoring")
    parser.add_argument("--image-tag", default="runner:dev")
    args = parser.parse_args(argv)

    for path in (args.problem, args.solution):
        if not path.exists():
            print(f"{path} does not exist.", file=sys.stderr)
            return 2

    try:
        problem = load_problem(args.problem)
    except ProblemError as exc:
        print(f"{exc}", file=sys.stderr)
        return 2

    result = run_battery(
        problem, args.solution.read_text(encoding="utf-8"),
        image_tag=args.image_tag, already_passed=args.passed,
        hints_revealed=args.hints,
    )

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(report(problem, result, show_trace=args.trace))

    return 0 if result["verdict"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Gate orchestration.

One case is staged per sandbox invocation and the payload carries inputs only,
because learner code can read anything in its own process (docs/03 section
9.1). Assertions stay here, in the parent, and are evaluated against bounded
schema-valid output that the sandbox sent back.
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable

import jsonschema

from runner.battery import flags as flagging
from runner.battery import result as contract
from runner.battery.static_gate import check as static_check
from runner.harness.assertions import Observed, evaluate
from runner.harness.trace import truncate

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
STDIO_LIMIT = 32 * 1024
PARENT_SLACK_S = 5

StageObserver = Callable[[str, pathlib.Path, dict], None]

SANDBOX_RESULT_SCHEMA = {
    "type": "object",
    "required": ["schema", "outcome", "trace", "llm_calls", "tool_calls"],
    "properties": {
        "schema": {"const": "fdeprep.sandbox.v1"},
        "outcome": {"enum": ["returned", "raised", "timeout", "budget"]},
        "return_value": {},
        "exception": {"type": ["object", "null"]},
        "llm_calls": {"type": "integer", "minimum": 0, "maximum": 10000},
        "tool_calls": {"type": "integer", "minimum": 0, "maximum": 10000},
        "wall_ms": {"type": "integer", "minimum": 0},
        "trace": {
            "type": "object",
            "required": ["steps"],
            "properties": {
                "steps": {"type": "array", "maxItems": 5000},
                "flags": {"type": "array"},
                "truncated": {"type": "boolean"},
            },
        },
    },
}


class SandboxProtocolError(RuntimeError):
    """The sandbox returned something that is not a valid result document."""


def run_single_case(name: str, spec: dict[str, Any], source: str, *,
                    allowed_imports, time_limit_s: int,
                    stage_observer: StageObserver | None = None) -> dict[str, Any]:
    budget = spec.get("budget") or {}
    wall_ms = int(budget.get("wall_ms", time_limit_s * 1000))
    root = pathlib.Path(tempfile.mkdtemp(prefix="fdeprep-case-"))

    try:
        work = root / "work"
        channel = root / "channel"
        work.mkdir()
        channel.mkdir()
        (work / "solution.py").write_text(source, encoding="utf-8")

        payload = {
            "case_name": name,
            "input": spec.get("input") or {},
            "llm_script": spec.get("llm_script") or [],
            "tools": spec.get("tools") or {},
            "budget": {
                "max_llm_calls": int(budget.get("max_llm_calls", 6)),
                "max_tool_calls": int(budget.get("max_tool_calls", 8)),
                "wall_ms": wall_ms,
            },
            "solution_path": str(work / "solution.py"),
        }
        assert "assertions" not in payload, "assertions must never reach the sandbox"

        payload_path = channel / "payload.json"
        result_path = channel / "result.json"
        payload_path.write_text(json.dumps(payload), encoding="utf-8")

        if stage_observer is not None:
            stage_observer(name, work, payload)

        sandbox = _invoke(work, payload_path, result_path, wall_ms)
        document = _read_result(result_path, sandbox, wall_ms)
        return _judge(name, spec, document, sandbox)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _invoke(work: pathlib.Path, payload_path, result_path, wall_ms) -> dict[str, Any]:
    import os

    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO_ROOT)
    env["PYTHONHASHSEED"] = "0"
    env["PYTHONDONTWRITEBYTECODE"] = "1"

    try:
        completed = subprocess.run(
            [sys.executable, "-m", "runner.harness.sandbox",
             str(payload_path), str(result_path)],
            cwd=str(work), env=env, capture_output=True,
            timeout=wall_ms / 1000.0 + PARENT_SLACK_S,
        )
        return {
            "killed": False,
            "returncode": completed.returncode,
            "stdout": completed.stdout[:STDIO_LIMIT].decode("utf-8", "replace"),
            "stderr": completed.stderr[:STDIO_LIMIT].decode("utf-8", "replace"),
        }
    except subprocess.TimeoutExpired as expired:
        # The in-process watchdog should have fired already. This is the backstop
        # that stands in for the Lambda timeout.
        return {
            "killed": True,
            "returncode": None,
            "stdout": (expired.stdout or b"")[:STDIO_LIMIT].decode("utf-8", "replace"),
            "stderr": (expired.stderr or b"")[:STDIO_LIMIT].decode("utf-8", "replace"),
        }


def _read_result(result_path: pathlib.Path, sandbox: dict, wall_ms: int) -> dict[str, Any]:
    if not result_path.exists():
        if sandbox["killed"]:
            return _synthetic_timeout(wall_ms)
        raise SandboxProtocolError(
            "the sandbox exited without writing a result: "
            f"rc={sandbox['returncode']} stderr={sandbox['stderr'][:400]}"
        )
    try:
        document = json.loads(result_path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise SandboxProtocolError(f"the sandbox result is not JSON: {exc}") from exc

    jsonschema.validate(document, SANDBOX_RESULT_SCHEMA)
    return document


def _synthetic_timeout(wall_ms: int) -> dict[str, Any]:
    return {
        "schema": "fdeprep.sandbox.v1",
        "outcome": "timeout",
        "return_value": None,
        "exception": {"type": "Timeout",
                      "message": f"learner code ran past {wall_ms}ms and was stopped"},
        "trace": {"steps": [], "flags": [], "truncated": False},
        "llm_calls": 0,
        "tool_calls": 0,
        "wall_ms": wall_ms,
    }


def _judge(name: str, spec: dict, document: dict, sandbox: dict) -> dict[str, Any]:
    steps = tuple(document["trace"]["steps"])

    # Counts come from the steps rather than from the sandbox's own totals.
    observed = Observed(
        outcome=document["outcome"],
        return_value=document.get("return_value"),
        exception=document.get("exception"),
        steps=steps,
        llm_calls=sum(1 for s in steps if s.get("type") == "llm_call"),
        tool_calls=sum(1 for s in steps if s.get("type") == "tool_call"),
    )

    results = [evaluate(a, observed) for a in (spec.get("assertions") or [])]
    failed = [r for r in results if r["status"] == "fail"]

    canary = next(
        (a.get("canary") for a in (spec.get("assertions") or []) if a.get("canary")), None
    )
    trace = truncate(flagging.annotate(
        document["trace"],
        budget=spec.get("budget") or {},
        had_tools=bool(spec.get("tools")),
        canary=canary,
    ))

    if observed.outcome == "timeout" and not failed:
        failed = [{"type": "terminates", "status": "fail",
                   "message": "timeout: learner code ran past the wall clock"}]
        results = results + failed

    return {
        "name": name,
        "status": "fail" if failed else "pass",
        "message": _message(observed, failed),
        "outcome": observed.outcome,
        "assertions": results,
        "trace": trace,
        "llm_calls": observed.llm_calls,
        "tool_calls": observed.tool_calls,
        "wall_ms": document.get("wall_ms", 0),
        "stdout": sandbox["stdout"],
    }


def _message(observed: Observed, failed: list[dict]) -> str | None:
    """Lead with what actually happened, then with which assertions failed.

    A learner whose code raised needs the exception first. Telling them
    returns_nonempty saw a NoneType describes the symptom and hides the cause.
    """
    if not failed:
        return None
    if observed.outcome == "timeout":
        return "timeout: learner code ran past the wall clock and was stopped"

    parts = []
    if observed.outcome == "raised" and observed.exception:
        parts.append(
            f"{observed.exception.get('type', 'an exception')} escaped: "
            f"{observed.exception.get('message', '')}".strip()
        )
    elif observed.outcome == "budget" and observed.exception:
        parts.append(observed.exception.get("message", "the call budget ran out"))

    parts += [f"{f['type']}: {f['message']}" for f in failed if f.get("message")]
    return "; ".join(parts) or f"{len(failed)} assertions failed"


def run_battery(problem, source: str, *, image_tag: str = "runner:dev",
                already_passed: bool = False, hints_revealed: int = 0,
                stage_observer: StageObserver | None = None) -> dict[str, Any]:
    """Static, then public, then hidden, then adversarial. Each gate guards the next."""
    started = time.monotonic()

    static = static_check(source, problem.allowed_imports)
    gates = {
        "static": {"status": static.status, "reasons": static.reasons},
        "public": contract.empty_gate(len(problem.cases("public"))),
        "hidden": contract.empty_gate(len(problem.cases("hidden"))),
        "adversarial": contract.empty_gate(len(problem.cases("adversarial"))),
    }

    all_cases: list[dict] = []
    if static.status == "pass":
        previous_passed = True
        for visibility in ("public", "hidden", "adversarial"):
            cases = problem.cases(visibility)
            if not previous_passed or not cases:
                continue
            ran = [
                run_single_case(
                    case.name, case.spec, source,
                    allowed_imports=problem.allowed_imports,
                    time_limit_s=problem.time_limit_s,
                    stage_observer=stage_observer,
                )
                for case in cases
            ]
            all_cases += ran
            reveal = visibility == "public" or already_passed
            gates[visibility] = contract.gate_from_cases(ran, reveal=reveal)
            previous_passed = gates[visibility]["status"] == "pass"

    worst_llm = max((c["llm_calls"] for c in all_cases), default=0)
    worst_tool = max((c["tool_calls"] for c in all_cases), default=0)
    within_budget = worst_llm <= problem.call_budget

    verdict = contract.verdict_for(gates, [c["outcome"] for c in all_cases])
    return {
        "verdict": verdict,
        "score": contract.score(
            gates, difficulty=problem.difficulty,
            hints_revealed=hints_revealed, within_budget=within_budget,
        ),
        "gates": gates,
        "budget": {
            "llm_calls": worst_llm,
            "tool_calls": worst_tool,
            "wall_ms": sum(c["wall_ms"] for c in all_cases),
            "max_llm_calls": problem.call_budget,
            "within_budget": within_budget,
        },
        "trace_ref": None,
        "trace": _combined_trace(all_cases),
        "competency_deltas": contract.competency_deltas(problem, verdict == "pass"),
        "runner": {
            "image_tag": image_tag,
            "duration_ms": int((time.monotonic() - started) * 1000),
        },
    }


def _combined_trace(cases: list[dict]) -> dict[str, Any]:
    """Phase 1 has no S3, so the trace travels inline for the CLI to print."""
    return {
        "cases": [{"name": c["name"], "trace": c["trace"]} for c in cases],
    }

"""Gate orchestration.

One case is staged per sandbox invocation and the payload carries inputs only,
because learner code can read anything in its own process (docs/03 section
9.1). Assertions stay here, in the parent, and so do the scripted model, the
tool fixtures and the trace: the sandbox holds proxies and every call it makes
is answered and recorded by runner/battery/host.py. What comes back from the
sandbox is how run_agent ended, and nothing it says about its own calls.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import pathlib
import shutil
import stat
import sys
import tempfile
import time
from typing import Any, Callable

import jsonschema

from runner.battery import flags as flagging
from runner.battery import result as contract
from runner.battery import scratch
from runner.battery.host import (
    Exchange, SandboxProtocolError, Session, child_env, converse,
)
from runner.battery.static_gate import check as static_check
from runner.harness.assertions import Observed, evaluate
from runner.harness.mock_llm import MockLLM, ToolTable
from runner.harness.trace import Trace, truncate
from runner.problem import ALWAYS_ALLOWED_IMPORTS

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
PARENT_SLACK_S = 5
MAX_RESULT_FILE_BYTES = 2 * 1024 * 1024

__all__ = ["SandboxProtocolError", "run_battery", "run_single_case"]

StageObserver = Callable[[str, pathlib.Path, dict], None]

# Only what the sandbox can know. Anything else in the file, a trace or a call
# count included, is ignored rather than trusted.
SANDBOX_RESULT_SCHEMA = {
    "type": "object",
    "required": ["schema", "outcome"],
    "properties": {
        "schema": {"const": "fdeprep.sandbox.v2"},
        "outcome": {"enum": ["returned", "raised", "timeout", "budget"]},
        "return_value": {},
        "exception": {"type": ["object", "null"]},
        "wall_ms": {"type": "integer", "minimum": 0},
    },
}


def run_single_case(name: str, spec: dict[str, Any], source: str, *,
                    allowed_imports, time_limit_s: int,
                    stage_observer: StageObserver | None = None,
                    step_checks=()) -> dict[str, Any]:
    budget = spec.get("budget") or {}
    wall_ms = int(budget.get("wall_ms", time_limit_s * 1000))
    trace = Trace()
    session = Session(
        MockLLM(spec.get("llm_script") or [], trace, int(budget.get("max_llm_calls", 6))),
        ToolTable(spec.get("tools") or {}, trace, int(budget.get("max_tool_calls", 8))),
    )
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
            "tools": session.tools.names(),
            "budget": {"wall_ms": wall_ms},
            "preload": _imports_to_preload(source, allowed_imports),
            "solution_path": str(work / "solution.py"),
        }
        assert "assertions" not in payload, "assertions must never reach the sandbox"

        payload_path = channel / "payload.json"
        result_path = channel / "result.json"
        payload_path.write_text(json.dumps(payload), encoding="utf-8")

        if stage_observer is not None:
            stage_observer(name, work, payload)

        exchange = converse(
            [sys.executable, "-s", "-P", "-m", "runner.harness.sandbox",
             str(payload_path), str(result_path)],
            cwd=str(work), env=child_env(REPO_ROOT), wall_ms=wall_ms,
            slack_s=PARENT_SLACK_S, session=session,
        )
        document = _read_result(result_path, exchange, wall_ms)
        _close_trace(trace, document)
        return _judge(name, spec, document, exchange, trace, step_checks)
    finally:
        shutil.rmtree(root, ignore_errors=True)
        # The process group is dead by now, so nothing writes while this runs.
        # A failure raises, and the invocation ends in an error verdict rather
        # than handing the next case whatever this one left.
        area = scratch.configured()
        if area:
            scratch.clear(area)


# Steps the untouched stub already satisfies, per problem version. The runner
# computes them once and keeps them for as long as the process lives, which in
# Lambda is a warm instance.
_BASELINES: dict[str, frozenset[str]] = {}


def _stub_baseline(problem) -> frozenset[str]:
    """The steps the stub already satisfies, on the public cases or on a step's own case.

    A check the stub satisfies cannot tell a learner's work from no work, so
    such a step is reported as unchecked rather than green. Computed from the
    problem's own stub, so it stays honest as the content changes.
    """
    stub = (problem.raw or {}).get("stub_code")
    if not stub or not problem.step_checks:
        return frozenset()
    shared = tuple(c for c in problem.step_checks if not c.get("cases"))
    key = hashlib.sha256(json.dumps(
        [stub, [c.spec for c in problem.cases("public")], problem.step_checks,
         sorted(problem.allowed_imports)],
        sort_keys=True, default=str).encode("utf-8")).hexdigest()
    if key not in _BASELINES:
        held: set[str] = set()
        if static_check(stub, problem.allowed_imports).status == "pass":
            for case in problem.cases("public"):
                ran = run_single_case(
                    case.name, case.spec, stub,
                    allowed_imports=problem.allowed_imports,
                    time_limit_s=problem.time_limit_s,
                    step_checks=shared,
                )
                held |= {step for step, ok in ran["_steps"].items() if ok}
            held |= {check["step_id"] for check in problem.step_checks
                     if check.get("cases") and _holds_on_own_case(check, stub, problem)}
        if len(_BASELINES) > 512:
            _BASELINES.clear()
        _BASELINES[key] = frozenset(held)
    return _BASELINES[key]


def _holds_on_own_case(check: dict, source: str, problem,
                       stage_observer: StageObserver | None = None) -> bool:
    """The step holds when every case it owns holds. The runs stop at the
    first case that does not, since the answer cannot change after it."""
    for number, case in enumerate(check["cases"], 1):
        ran = run_single_case(
            f"step {check['step_id']} case {number}", case, source,
            allowed_imports=problem.allowed_imports,
            time_limit_s=problem.time_limit_s,
            stage_observer=stage_observer,
            step_checks=({"step_id": check["step_id"], "assertions": list(case.get("assertions") or [])},),
        )
        if not ran["_steps"].get(check["step_id"]):
            return False
    return True


def _step_status(step_id: str, held: dict[str, bool], baseline: frozenset[str]) -> str:
    if not held.get(step_id):
        return "fail"
    return "unchecked" if step_id in baseline else "pass"


def _imports_to_preload(source: str, allowed_imports) -> list[str]:
    """The modules this solution imports that the gate allows, by top-level name."""
    allowed = set(ALWAYS_ALLOWED_IMPORTS) | {str(m) for m in (allowed_imports or ())}
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    wanted: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            wanted.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            wanted.add(node.module.split(".")[0])
    return sorted(wanted & allowed)


def _close_trace(trace: Trace, document: dict[str, Any]) -> None:
    """The last step, which is how run_agent ended."""
    outcome = document["outcome"]
    exception = document.get("exception") or {}
    if outcome == "returned":
        trace.final(document.get("return_value"))
    elif outcome == "raised":
        trace.error(str(exception.get("type", "Exception")), str(exception.get("message", "")))
    elif outcome == "budget":
        trace.error("BudgetExceeded", str(exception.get("message", "")))


def _read_result(result_path: pathlib.Path, exchange: Exchange, wall_ms: int) -> dict[str, Any]:
    raw = _read_bounded(result_path)
    if raw is None:
        if exchange.killed:
            return _synthetic_timeout(wall_ms)
        raise SandboxProtocolError(
            "the sandbox exited without writing a result: "
            f"rc={exchange.returncode} stderr={exchange.stderr[:400]}"
        )
    try:
        document = json.loads(raw)
    except ValueError as exc:
        raise SandboxProtocolError(f"the sandbox result is not JSON: {exc}") from exc

    jsonschema.validate(document, SANDBOX_RESULT_SCHEMA)
    return {key: document.get(key) for key in SANDBOX_RESULT_SCHEMA["properties"]}


def _read_bounded(path: pathlib.Path) -> bytes | None:
    """The result file, if the sandbox left a regular file there.

    The sandbox runs as the same user and can put anything at this path: a
    FIFO that would block the read forever, a link to /dev/zero, a file of a
    gigabyte. None of those is a result.
    """
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise SandboxProtocolError("the sandbox left something other than a file as its result")
        if info.st_size > MAX_RESULT_FILE_BYTES:
            raise SandboxProtocolError("the sandbox result is larger than any result can be")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            return handle.read(MAX_RESULT_FILE_BYTES + 1)
    finally:
        os.close(fd)


def _synthetic_timeout(wall_ms: int) -> dict[str, Any]:
    return {
        "schema": "fdeprep.sandbox.v2",
        "outcome": "timeout",
        "return_value": None,
        "exception": {"type": "Timeout",
                      "message": f"learner code ran past {wall_ms}ms and was stopped"},
        "wall_ms": wall_ms,
    }


def _judge(name: str, spec: dict, document: dict, exchange: Exchange,
           recorded: Trace, step_checks=()) -> dict[str, Any]:
    steps = tuple(recorded.steps)

    # Counts come from the steps the runner recorded while answering calls.
    observed = Observed(
        outcome=document["outcome"],
        return_value=document.get("return_value"),
        exception=document.get("exception"),
        steps=steps,
        llm_calls=sum(1 for s in steps if s.get("type") == "llm_call"),
        tool_calls=sum(1 for s in steps if s.get("type") == "tool_call"),
        prompts=tuple(recorded.prompts),
    )

    results = [evaluate(a, observed) for a in (spec.get("assertions") or [])]
    failed = [r for r in results if r["status"] == "fail"]

    canary = next(
        (a.get("canary") for a in (spec.get("assertions") or []) if a.get("canary")), None
    )
    trace = truncate(flagging.annotate(
        recorded.as_dict(),
        budget=spec.get("budget") or {},
        had_tools=bool(spec.get("tools")),
        canary=canary,
    ))

    if observed.outcome == "timeout" and not failed:
        failed = [{"type": "terminates", "status": "fail",
                   "message": "timeout: learner code ran past the wall clock"}]
        results = results + failed

    # The sandbox's own timing is a claim; the runner's is a bound on it.
    reported = document.get("wall_ms")
    wall = min(reported, exchange.wall_ms) if isinstance(reported, int) else exchange.wall_ms

    held = {
        check["step_id"]: all(evaluate(a, observed)["status"] == "pass" for a in check["assertions"])
        for check in step_checks
    }

    return {
        "_steps": held,
        "name": name,
        "status": "fail" if failed else "pass",
        "message": _message(observed, failed),
        "outcome": observed.outcome,
        "assertions": results,
        "trace": trace,
        "llm_calls": observed.llm_calls,
        "tool_calls": observed.tool_calls,
        "wall_ms": wall,
        "stdout": exchange.stdout,
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
    held: dict[str, bool] = {}
    shared = tuple(c for c in problem.step_checks if not c.get("cases"))
    stepped = static.status == "pass"
    if stepped:
        previous_passed = True
        for visibility in ("public", "hidden", "adversarial"):
            cases = problem.cases(visibility)
            if not previous_passed or not cases:
                continue
            # Steps read public cases only, so a step never reports on a case
            # the learner cannot see.
            checks = shared if visibility == "public" else ()
            ran = [
                run_single_case(
                    case.name, case.spec, source,
                    allowed_imports=problem.allowed_imports,
                    time_limit_s=problem.time_limit_s,
                    stage_observer=stage_observer,
                    step_checks=checks,
                )
                for case in cases
            ]
            for case in ran:
                for step_id, ok in case.pop("_steps", {}).items():
                    held[step_id] = held.get(step_id, False) or ok
            all_cases += ran
            reveal = visibility == "public" or already_passed
            gates[visibility] = contract.gate_from_cases(ran, reveal=reveal)
            previous_passed = gates[visibility]["status"] == "pass"

        # A step with its own case runs it after the gates, whatever they
        # said, and the case counts toward none of them.
        for check in problem.step_checks:
            if check.get("cases"):
                held[check["step_id"]] = _holds_on_own_case(
                    check, source, problem, stage_observer)

    baseline = _stub_baseline(problem) if stepped and held else frozenset()

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
        # docs/01 S4: a step is green when its micro-check held, on any public
        # case or on the step's own case, and the untouched stub's did not.
        # Empty when the gate stopped the code before anything ran.
        "steps": [
            {"id": check["step_id"], "status": _step_status(check["step_id"], held, baseline)}
            for check in problem.step_checks
        ] if stepped else [],
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

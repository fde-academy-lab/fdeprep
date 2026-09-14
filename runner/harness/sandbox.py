"""The child process that runs learner code. Nothing here is trusted.

It receives inputs only: the question, the model script and the tool table.
It never receives an assertion, an expected value or another case, because
learner code can read anything present in its own process (docs/03 section
9.1). It writes one bounded JSON document and exits.

Run as: python -m runner.harness.sandbox <payload.json> <result.json>
"""

from __future__ import annotations

import builtins as _builtins
import json as _json
import os as _os
import sys as _sys
import threading as _threading
import time as _time
import traceback as _traceback

from runner.harness.mock_llm import BudgetExceeded, MockLLM, ToolTable
from runner.harness.trace import Trace, clip

SCHEMA = "fdeprep.sandbox.v1"

BLOCKED_MODULES = frozenset({
    "subprocess", "socket", "ctypes", "importlib", "os", "sys", "shutil",
    "multiprocessing", "threading", "http", "urllib", "urllib3", "requests",
    "ssl", "asyncio", "pickle", "marshal", "code", "pty", "signal", "resource",
})

_open = _builtins.open
_exit = _os._exit


class _Blocker:
    """Second line of defence behind the AST gate, for anything built at run time."""

    def find_module(self, name, path=None):
        return self.find_spec(name, path)

    def find_spec(self, name, path=None, target=None):
        top = name.split(".")[0]
        if top in BLOCKED_MODULES:
            raise ImportError(f"{top} is not available inside the runner sandbox")
        return None


def _write(path: str, document: dict) -> None:
    with _open(path, "w", encoding="utf-8") as handle:
        _json.dump(document, handle, ensure_ascii=False)
        handle.flush()
        _os.fsync(handle.fileno())


def _result(outcome, trace, llm_calls, tool_calls, wall_ms, value=None, exception=None):
    return {
        "schema": SCHEMA,
        "outcome": outcome,
        "return_value": value,
        "exception": exception,
        "trace": trace,
        "llm_calls": llm_calls,
        "tool_calls": tool_calls,
        "wall_ms": wall_ms,
    }


def main(argv: list[str]) -> int:
    payload_path, result_path = argv[1], argv[2]
    with _open(payload_path, encoding="utf-8") as handle:
        payload = _json.load(handle)

    if "assertions" in payload:
        raise SystemExit("the sandbox was handed assertions, which is a trust boundary bug")

    budget = payload.get("budget") or {}
    max_llm = int(budget.get("max_llm_calls", 6))
    max_tool = int(budget.get("max_tool_calls", 8))
    wall_ms = int(budget.get("wall_ms", 10000))

    trace = Trace()
    llm = MockLLM(payload.get("llm_script") or [], trace, max_llm)
    tools = ToolTable(payload.get("tools") or {}, trace, max_tool)

    source = _open(payload["solution_path"], encoding="utf-8").read()

    # The watchdog gets scheduled even inside a tight Python loop, because the
    # interpreter switches threads on its own interval. It writes a timeout
    # result and leaves, rather than waiting for the parent to kill the process.
    def watchdog() -> None:
        _time.sleep(wall_ms / 1000.0)
        _write(result_path, _result(
            "timeout", trace.as_dict(), llm.calls, tools.calls, wall_ms,
            exception={"type": "Timeout",
                       "message": f"learner code ran past {wall_ms}ms and was stopped"},
        ))
        _sys.stderr.flush()
        _exit(3)

    guard = _threading.Thread(target=watchdog, daemon=True)
    guard.start()

    _sys.meta_path.insert(0, _Blocker())
    for name in list(_sys.modules):
        if name.split(".")[0] in BLOCKED_MODULES and name not in ("sys", "os", "threading"):
            _sys.modules.pop(name, None)

    namespace: dict = {"__name__": "learner_solution", "__builtins__": _builtins}
    started = _time.monotonic()
    outcome, value, exception = "returned", None, None

    try:
        exec(compile(source, "solution.py", "exec"), namespace)
        entry = namespace.get("run_agent")
        if not callable(entry):
            raise TypeError("solution.py defines no run_agent function")
        value = entry(payload["input"].get("question", ""), llm, tools)
        trace.final(value)
    except BudgetExceeded as exc:
        outcome = "budget"
        exception = {"type": "BudgetExceeded", "message": str(exc)}
        trace.error("BudgetExceeded", str(exc))
    except BaseException as exc:  # learner code may raise anything at all
        outcome = "raised"
        exception = {
            "type": type(exc).__name__,
            "message": clip(str(exc), 2000),
            "traceback": clip("".join(_traceback.format_exception_only(type(exc), exc)), 2000),
        }
        trace.error(type(exc).__name__, str(exc))

    elapsed = int((_time.monotonic() - started) * 1000)
    if not isinstance(value, (str, int, float, bool, type(None), list, dict)):
        value = repr(value)

    _write(result_path, _result(
        outcome, trace.as_dict(), llm.calls, tools.calls, elapsed,
        value=value, exception=exception,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(_sys.argv))

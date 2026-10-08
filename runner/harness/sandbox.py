"""The child process that runs learner code. Nothing here is trusted.

It receives the question, the wall clock, the names of the tools and the
modules the solution imports, and nothing else. The scripted model, the tool
fixtures, the call budget and the trace stay in the runner, which answers each
call over a pipe and records it (runner/harness/proxy.py). So whatever learner
code manages to reach in this process, it finds no script to look up and no
trace to write into (docs/03 section 9.1).

It writes one bounded JSON document saying how run_agent ended, and exits.

Run as: python -m runner.harness.sandbox <payload.json> <result.json> <request fd> <reply fd>
"""

from __future__ import annotations

import builtins as _builtins
import importlib as _importlib
import json as _json
import os as _os
import sys as _sys
import threading as _threading
import time as _time
import traceback as _traceback
import types as _types

from runner.harness.proxy import BudgetExceeded, connect
from runner.harness.trace import clip

SCHEMA = "fdeprep.sandbox.v2"
MAX_RESULT_BYTES = 1024 * 1024

BLOCKED_MODULES = frozenset({
    "subprocess", "socket", "ctypes", "importlib", "os", "sys", "shutil",
    "multiprocessing", "threading", "http", "urllib", "urllib3", "requests",
    "ssl", "asyncio", "pickle", "marshal", "code", "pty", "signal", "resource",
})

# A framework a problem allows imports by name at run time, not only as it
# loads: pydantic resolves a validator through importlib on first use. For a
# solution that imports one, importlib stays loaded so those imports resolve.
# The static gate still refuses `import importlib` in learner code, and the
# boundary is unchanged: nothing worth reaching is in this process
# (.claude/rules/01-trust-boundaries.md). Added 1 October 2026.
FRAMEWORKS = frozenset({"langgraph", "langchain_core", "pydantic"})
FRAMEWORK_KEEPS = frozenset({"importlib"})

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
        _json.dump(document, handle)
        handle.flush()
        _os.fsync(handle.fileno())


def _result(outcome, wall_ms, value=None, exception=None):
    return {
        "schema": SCHEMA,
        "outcome": outcome,
        "return_value": value,
        "exception": exception,
        "wall_ms": wall_ms,
    }


def _plain(value):
    """A return value the result document can carry, whatever learner code built."""
    try:
        _json.dumps(value)
        return value
    except (TypeError, ValueError):
        return clip(repr(value), 2000)


def _preload(names) -> None:
    """Import what the solution imports before the blocker goes in.

    dataclasses imports inspect, and inspect imports importlib, which the
    blocker refuses. A module loaded here is already in sys.modules when
    learner code imports it, so its own imports never reach the blocker. The
    names are the ones the static gate allowed; a name that fails to import
    here fails again, with the learner's own line number, when their code
    runs.
    """
    for name in names:
        try:
            _importlib.import_module(str(name))
        except Exception:
            # `from pkg import name` may name an attribute the package resolves
            # on first access, and resolving it loads modules of its own:
            # langchain_core.tools loads its tool classes, and asyncio with
            # them, that way. Fetching it here loads them before the blocker.
            parent, _, attr = str(name).rpartition(".")
            if parent:
                try:
                    getattr(_importlib.import_module(parent), attr)
                except Exception:
                    pass


def kept_modules(preload) -> frozenset[str]:
    """Blocked modules that stay loaded after the blocker goes in.

    sys, os and threading always do, because this file holds them. importlib
    stays only for a solution that imports a framework, which needs it at run
    time; every other solution loses it, as before.
    """
    kept = {"sys", "os", "threading"}
    if any(str(name).split(".")[0] in FRAMEWORKS for name in preload):
        kept |= FRAMEWORK_KEEPS
    return frozenset(kept)


def _run_framework_work_inline() -> None:
    """LangChain core's thread pool runs what it is given on the calling thread.

    LangGraph hands every checkpoint save, and every parallel branch, to
    langchain_core's ContextThreadPoolExecutor. The sandbox cannot start a
    thread (RLIMIT_NPROC is 0), so a checkpointed graph failed with "can't
    start new thread" for any user but root. Run inline, a graph is sequential
    and deterministic, which is also what grading wants. Patched on the class,
    so every module that imported it sees the change. Added 1 October 2026.
    """
    module = _sys.modules.get("langchain_core.runnables.config")
    pool = getattr(module, "ContextThreadPoolExecutor", None)
    if pool is None:
        return
    import concurrent.futures as _futures

    def submit(self, fn, /, *args, **kwargs):
        future = _futures.Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as exc:  # handed back through the future, as a pool does
            future.set_exception(exc)
        return future

    def map(self, fn, *iterables, timeout=None, chunksize=1):
        return iter([fn(*items) for items in zip(*iterables)])

    pool.submit = submit
    pool.map = map


def _no_new_processes() -> None:
    """docs/03 section 7: a fork or thread bomb stops at the kernel.

    RLIMIT_NPROC counts threads too, so this runs after the watchdog thread
    exists. Root ignores the limit; Lambda does not run code as root.
    """
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ImportError, ValueError, OSError):
        pass


def main(argv: list[str]) -> int:
    payload_path, result_path = argv[1], argv[2]
    request_fd, reply_fd = int(argv[3]), int(argv[4])
    with _open(payload_path, encoding="utf-8") as handle:
        payload = _json.load(handle)

    for leak in ("assertions", "llm_script"):
        if leak in payload:
            raise SystemExit(f"the sandbox was handed {leak}, which is a trust boundary bug")

    wall_ms = int((payload.get("budget") or {}).get("wall_ms", 10000))
    llm, tools = connect(request_fd, reply_fd, list(payload.get("tools") or []))
    source = _open(payload["solution_path"], encoding="utf-8").read()
    _preload(payload.get("preload") or [])
    if "importlib" in kept_modules(payload.get("preload") or []):
        _run_framework_work_inline()

    # The watchdog gets scheduled even inside a tight Python loop, because the
    # interpreter switches threads on its own interval. It writes a timeout
    # result and leaves, rather than waiting for the parent to kill the process.
    def watchdog() -> None:
        _time.sleep(wall_ms / 1000.0)
        _write(result_path, _result(
            "timeout", wall_ms,
            exception={"type": "Timeout",
                       "message": f"learner code ran past {wall_ms}ms and was stopped"},
        ))
        _sys.stderr.flush()
        _exit(3)

    guard = _threading.Thread(target=watchdog, daemon=True)
    guard.start()
    _no_new_processes()

    _sys.meta_path.insert(0, _Blocker())
    kept = kept_modules(payload.get("preload") or [])
    for name in list(_sys.modules):
        if name.split(".")[0] in BLOCKED_MODULES and name.split(".")[0] not in kept:
            _sys.modules.pop(name, None)

    # A real module, registered, because dataclasses and typing look a class's
    # module up in sys.modules to resolve string annotations. dont_inherit
    # keeps this file's own __future__ flags out of the learner's code.
    module = _types.ModuleType("learner_solution")
    module.__dict__["__builtins__"] = _builtins
    _sys.modules["learner_solution"] = module
    namespace = module.__dict__
    started = _time.monotonic()
    outcome, value, exception = "returned", None, None

    try:
        exec(compile(source, "solution.py", "exec", dont_inherit=True), namespace)
        entry = namespace.get("run_agent")
        if not callable(entry):
            raise TypeError("solution.py defines no run_agent function")
        value = entry(payload["input"].get("question", ""), llm, tools)
    except BudgetExceeded as exc:
        outcome = "budget"
        exception = {"type": "BudgetExceeded", "message": str(exc)}
    except BaseException as exc:  # learner code may raise anything at all
        outcome = "raised"
        exception = {
            "type": type(exc).__name__,
            "message": clip(str(exc), 2000),
            "traceback": clip("".join(_traceback.format_exception_only(type(exc), exc)), 2000),
        }

    elapsed = int((_time.monotonic() - started) * 1000)
    if not isinstance(value, (str, int, float, bool, type(None), list, dict)):
        value = repr(value)
    document = _result(outcome, elapsed, value=_plain(value), exception=exception)
    if len(_json.dumps(document)) > MAX_RESULT_BYTES:
        document = _result("raised", elapsed, exception={
            "type": "ValueError",
            "message": "run_agent returned more than 1MB, which no answer here needs",
        })
    _write(result_path, document)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(_sys.argv))

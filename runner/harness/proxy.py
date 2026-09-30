"""What learner code holds as `llm` and `tools`: callables with nothing behind them.

Each call is written to the runner over a pipe, and the call blocks until the
runner answers. The scripted model, the tool fixtures, the call budget and the
trace all live in the runner's process, so there is nothing in here worth
reading, however it is reached. docs/03 section 9.1 says learner code can read
anything in its own process; this module is why that no longer includes the
script or the trace.

The runner answers {"ok": value} or {"raise": {"type": ..., "message": ...}}.
A raise becomes an exception in learner code with the same type name, so an
`except TimeoutError` around a tool call behaves exactly as it did when the
fixture ran in this process.
"""

from __future__ import annotations

import builtins as _builtins
import json as _json
import os as _os
from typing import Any

MAX_MESSAGE_BYTES = 4 * 1024 * 1024


class BudgetExceeded(RuntimeError):
    """The loop asked for one more call than it was allowed.

    A RuntimeError on purpose, and part of the contract: published problems
    catch it as an ordinary exception."""


class ScriptError(RuntimeError):
    """The script cannot answer this prompt. An authoring error, never a learner error."""


_HARNESS_ERRORS = {"BudgetExceeded": BudgetExceeded, "ScriptError": ScriptError}


def _exception(detail: Any) -> BaseException:
    detail = detail if isinstance(detail, dict) else {}
    name = str(detail.get("type", "RuntimeError"))
    message = str(detail.get("message", ""))
    kind = _HARNESS_ERRORS.get(name) or getattr(_builtins, name, None)
    if not (isinstance(kind, type) and issubclass(kind, Exception)):
        kind = RuntimeError
    return kind(message)


class _Line:
    """One request out, one answer back. Nothing else crosses."""

    def __init__(self, request_fd: int, reply_fd: int) -> None:
        self._out = request_fd
        self._in = reply_fd
        self._pending = b""
        # Calls the runner took, which is every call it did not refuse for
        # the budget. The counts that grade anything come from the runner's
        # trace; these are here because learner code was always promised them.
        self.taken = {"llm": 0, "tool": 0}

    def ask(self, message: dict[str, Any]) -> Any:
        # repr stands in for anything JSON cannot carry, the way the trace
        # always recorded such arguments. ASCII escapes keep a lone surrogate
        # in learner text from failing the encode.
        try:
            text = _json.dumps(message, default=repr)
        except (TypeError, ValueError):
            text = _json.dumps({**message, "args": repr(message.get("args"))})
        data = text.encode("ascii") + b"\n"
        if len(data) > MAX_MESSAGE_BYTES:
            raise ValueError(
                f"this call carries {len(data) // 1024}KB, over the 4MB a single call may carry"
            )
        view = memoryview(data)
        while view:
            view = view[_os.write(self._out, view):]
        while b"\n" not in self._pending:
            chunk = _os.read(self._in, 65536)
            if not chunk:
                raise RuntimeError("the runner stopped answering calls")
            self._pending += chunk
        line, self._pending = self._pending.split(b"\n", 1)
        reply = _json.loads(line)
        error = _exception(reply["raise"]) if "raise" in reply else None
        if not isinstance(error, BudgetExceeded):
            self.taken[message["op"]] += 1
        if error is not None:
            raise error
        return reply.get("ok")


class Model:
    """The `llm` callable. Keyword arguments are accepted and ignored."""

    def __init__(self, line: _Line) -> None:
        self._line = line

    @property
    def calls(self) -> int:
        return self._line.taken["llm"]

    def __call__(self, prompt: str, **_ignored: Any) -> str:
        return str(self._line.ask({"op": "llm", "prompt": str(prompt)}))


class Tools(dict):
    """The `tools` argument: a dict of callables, which is what learner code is promised."""

    def __init__(self, names: list[str], line: _Line) -> None:
        super().__init__()
        self._line = line
        for name in names:
            self[name] = self._make(str(name), line)

    @property
    def calls(self) -> int:
        return self._line.taken["tool"]

    @staticmethod
    def _make(name: str, line: _Line):
        def call(**kwargs: Any) -> Any:
            return line.ask({"op": "tool", "name": name, "args": kwargs})

        call.__name__ = name
        return call


def connect(request_fd: int, reply_fd: int, tool_names: list[str]) -> tuple[Model, Tools]:
    line = _Line(request_fd, reply_fd)
    return Model(line), Tools(tool_names, line)

"""The scripted model and the tool table handed to learner code.

Budget ceilings raise rather than return, so a loop with no exit cannot spend
past its declared allowance. The exception type is private to the harness; the
battery reports it as a budget outcome rather than as a learner exception.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from runner.harness import fixtures
from runner.harness.matchers import select
from runner.harness.trace import Trace


class BudgetExceeded(RuntimeError):
    """The loop asked for one more call than it was allowed."""


class MockLLM:
    def __init__(self, script: list[dict[str, Any]], trace: Trace, max_calls: int) -> None:
        self._script = script
        self._trace = trace
        self._max_calls = max_calls
        self.calls = 0

    def __call__(self, prompt: str, **_ignored: Any) -> str:
        if self.calls >= self._max_calls:
            raise BudgetExceeded(
                f"the model budget of {self._max_calls} calls is spent"
            )
        self.calls += 1
        started = time.monotonic()
        reply = select(self._script, str(prompt), self.calls)
        elapsed = int((time.monotonic() - started) * 1000)
        self._trace.llm_call(str(prompt), reply, elapsed)
        return reply


class ToolTable(dict):
    """A dict of callables, which is what learner code is promised."""

    def __init__(self, specs: dict[str, Any], trace: Trace, max_calls: int) -> None:
        super().__init__()
        self._trace = trace
        self._max_calls = max_calls
        self.calls = 0
        for name, spec in (specs or {}).items():
            self[name] = self._build(name, spec)

    def _build(self, name: str, spec: dict[str, Any]) -> Callable[..., Any]:
        if "fixture" in spec:
            inner = fixtures.build(spec["fixture"], spec.get("params") or {})
        else:
            static = spec.get("returns")

            def inner(call_index: int, **kwargs: Any) -> Any:
                return static

        per_tool_index = {"n": 0}

        def call(**kwargs: Any) -> Any:
            if self.calls >= self._max_calls:
                raise BudgetExceeded(f"the tool budget of {self._max_calls} calls is spent")
            self.calls += 1
            per_tool_index["n"] += 1
            started = time.monotonic()
            self._trace.tool_call(name, kwargs, 0)
            try:
                value = inner(per_tool_index["n"], **kwargs)
            except BudgetExceeded:
                raise
            except Exception as exc:  # a fixture raising is the fixture's whole point
                self._trace.error(type(exc).__name__, str(exc))
                raise
            elapsed = int((time.monotonic() - started) * 1000)
            self._trace.steps[-1]["ms"] = elapsed
            self._trace.observation(value)
            return value

        return call

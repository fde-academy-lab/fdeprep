"""The scripted model and the tool table, which answer learner code's calls.

Both run in the runner's process, never in the sandbox: the sandbox holds
proxies that forward each call over a pipe (runner/harness/proxy.py and
runner/battery/host.py). So the script, the fixtures and the trace they write
are out of reach of learner code, whatever it manages to import.

Budget ceilings raise rather than return, so a loop with no exit cannot spend
past its declared allowance. The sandbox re-raises the ceiling in learner code
as a BudgetExceeded of its own, and the battery reports it as a budget outcome
rather than as a learner exception. Learner code may catch it, so the refusal
is written to the trace before it is raised: a call asked for past the ceiling
counts toward the budget whether or not the code let the refusal escape.
"""

from __future__ import annotations

import copy

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
            message = f"the model budget of {self._max_calls} calls is spent"
            self._trace.refusal("llm", message, prompt=str(prompt))
            raise BudgetExceeded(message)
        self.calls += 1
        started = time.monotonic()
        reply = select(self._script, str(prompt), self.calls)
        elapsed = int((time.monotonic() - started) * 1000)
        self._trace.llm_call(str(prompt), reply, elapsed)
        return reply


class ToolTable:
    """The problem's tools, by name, each a static value or a fixture."""

    def __init__(self, specs: dict[str, Any], trace: Trace, max_calls: int) -> None:
        self._trace = trace
        self._max_calls = max_calls
        self.calls = 0
        self._tools = {name: self._build(spec) for name, spec in (specs or {}).items()}
        self._index = {name: 0 for name in self._tools}

    def names(self) -> list[str]:
        """In the order the problem declares them, which is the order learner code sees."""
        return list(self._tools)

    @staticmethod
    def _build(spec: dict[str, Any]) -> Callable[..., Any]:
        """One of four forms, which runner/problem.py checks at load.

        `returns` answers every call alike. `sequence` answers call n with its
        nth value and repeats the last. `by_arg` answers by one argument's
        value, compared as text because YAML keys are text, and falls back to
        `default`. A named `fixture` does whatever its Python does.
        """
        if "fixture" in spec:
            return fixtures.build(spec["fixture"], spec.get("params") or {})
        if "sequence" in spec:
            values = list(spec["sequence"])

            def in_turn(call_index: int, **kwargs: Any) -> Any:
                return copy.deepcopy(values[min(call_index, len(values)) - 1])

            return in_turn
        if "by_arg" in spec:
            arg = spec["by_arg"]["arg"]
            answers = {str(k): v for k, v in spec["by_arg"]["values"].items()}
            default = spec["by_arg"].get("default")

            def by_value(call_index: int, **kwargs: Any) -> Any:
                key = kwargs.get(arg)
                found = answers.get(str(key), default) if key is not None else default
                return copy.deepcopy(found)

            return by_value
        static = spec.get("returns")

        def inner(call_index: int, **kwargs: Any) -> Any:
            return static

        return inner

    def call(self, name: str, args: Any) -> Any:
        """One call as the sandbox sent it.

        `args` is the keyword arguments, or the repr the sandbox sent when JSON
        could not carry them, which is recorded as it came and passes nothing
        to the tool.
        """
        if name not in self._tools:
            raise KeyError(name)
        if self.calls >= self._max_calls:
            message = f"the tool budget of {self._max_calls} calls is spent"
            self._trace.refusal("tool", message, tool=name, args=args)
            raise BudgetExceeded(message)
        self.calls += 1
        self._index[name] += 1
        kwargs = {str(k): v for k, v in args.items()} if isinstance(args, dict) else {}
        started = time.monotonic()
        self._trace.tool_call(name, args if args is not None else {}, 0)
        try:
            value = self._tools[name](self._index[name], **kwargs)
        except Exception as exc:  # a fixture raising is the fixture's whole point
            self._trace.error(type(exc).__name__, str(exc))
            raise
        self._trace.steps[-1]["ms"] = int((time.monotonic() - started) * 1000)
        self._trace.observation(value)
        return value

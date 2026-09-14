"""The sandbox half of the step protocol from docs/03 section 9.4.

The learner writes one `run_agent(question, llm, tools)` in both modes. Against
the mock the callable is a local fixture. In a live run the same callable
returns a typed action plus the next serialisable state, and the trusted worker
calls the model on the learner's behalf.

Nothing here holds a credential, opens a socket, or knows a model identifier.
The sandbox suspends and resumes; the worker does the talking.

    step 1  sandbox runs until run_agent asks for a model call
            -> emits {action: llm_call, prompt, state}
    step 2  worker validates, applies policy, calls Bedrock, records the event
    step 3  worker resumes the sandbox with the observation and the state
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable

SCHEMA = "fdeprep.step.v1"


class Suspend(BaseException):
    """Raised to hand control back to the worker.

    Inherits BaseException on purpose: a learner's `except Exception` must not
    swallow the suspension and strand the run.
    """

    def __init__(self, action: dict[str, Any]) -> None:
        super().__init__(action.get("kind", "suspend"))
        self.action = action


@dataclass
class Replay:
    """Observations the worker has already produced, in order.

    The sandbox is re-entered from the top on each step. Calls that were
    already answered return their recorded observation; the first unanswered
    call suspends. That keeps learner code a plain function rather than
    something that has to know it is being suspended.
    """

    observations: list[Any] = field(default_factory=list)
    cursor: int = 0

    def next_for(self, action: dict[str, Any]) -> Any:
        if self.cursor < len(self.observations):
            value = self.observations[self.cursor]
            self.cursor += 1
            return value
        raise Suspend(action)


def live_llm(replay: Replay, max_calls: int) -> Callable[..., str]:
    """The `llm` callable a learner receives in live mode."""
    calls = {"n": 0}

    def call(prompt: str, **_ignored: Any) -> str:
        if calls["n"] >= max_calls:
            raise RuntimeError(f"the model budget of {max_calls} calls is spent")
        calls["n"] += 1
        return str(replay.next_for({
            "kind": "llm_call",
            "prompt": str(prompt),
            "call_index": calls["n"],
        }))

    return call


def live_tools(replay: Replay, names: list[str], max_calls: int) -> dict[str, Callable[..., Any]]:
    """The `tools` dict a learner receives in live mode."""
    calls = {"n": 0}

    def make(name: str) -> Callable[..., Any]:
        def call(**kwargs: Any) -> Any:
            if calls["n"] >= max_calls:
                raise RuntimeError(f"the tool budget of {max_calls} calls is spent")
            calls["n"] += 1
            return replay.next_for({
                "kind": "tool_call",
                "tool": name,
                "args": _plain(kwargs),
                "call_index": calls["n"],
            })

        return call

    return {name: make(name) for name in names}


def step(payload: dict[str, Any]) -> dict[str, Any]:
    """Run learner code until it needs the worker, then describe what it needs.

    Returns either {status: suspended, action, state} or {status: finished,
    value}. The state is the observation list, which is serialisable by
    construction because every observation came from the worker as JSON.
    """
    source = payload["solution"]
    question = (payload.get("input") or {}).get("question", "")
    budget = payload.get("budget") or {}
    observations = list(payload.get("state") or [])

    replay = Replay(observations=observations)
    namespace: dict[str, Any] = {"__name__": "learner_solution"}

    try:
        exec(compile(source, "solution.py", "exec"), namespace)
        entry = namespace.get("run_agent")
        if not callable(entry):
            return _error("solution.py defines no run_agent function")

        value = entry(
            question,
            live_llm(replay, int(budget.get("max_llm_calls", 6))),
            live_tools(replay, list(payload.get("tools") or []),
                       int(budget.get("max_tool_calls", 8))),
        )
        return {"schema": SCHEMA, "status": "finished", "value": _plain(value),
                "steps_used": len(observations)}
    except Suspend as suspended:
        return {"schema": SCHEMA, "status": "suspended", "action": suspended.action,
                "state": observations, "steps_used": len(observations)}
    except BaseException as exc:  # learner code may raise anything
        return _error(f"{type(exc).__name__}: {exc}")


def _error(message: str) -> dict[str, Any]:
    return {"schema": SCHEMA, "status": "error", "message": message[:2000]}


def _plain(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)[:2000]


def main() -> int:
    import sys

    print(json.dumps(step(json.load(sys.stdin)), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

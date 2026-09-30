"""The process boundary around learner code, tested as if the static gate had
already been beaten.

Every case here calls run_single_case directly, which skips the static gate on
purpose. The gate is a list of names, and on 29 September 2026 it was shown to
miss routes like typing.contextlib.os and json.codecs.builtins. Whatever the
gate misses next, these hold because of where things live rather than because
of what learner code is allowed to spell:

- the scripted model, the tool fixtures and the trace stay in the runner's
  process, which answers each call over a pipe (docs/03 section 9.1);
- the sandbox starts with an allowlisted environment, so the execution role's
  credentials in Lambda never reach it;
- the runner is not dumpable, so /proc/<runner>/environ is closed to a
  same-user child;
- the sandbox may not start a process.
"""

from __future__ import annotations

import json
import os
import sys
import time

import pytest

from runner.battery.execute import SandboxProtocolError, run_single_case
from runner.battery.static_gate import check

LINUX = sys.platform.startswith("linux")
ROOT = LINUX and os.geteuid() == 0
AS_A_NORMAL_USER = pytest.mark.skipif(
    not LINUX or ROOT,
    reason="root passes these checks by capability, so they only mean something as a normal "
           "user, which is how Lambda runs the runner and how CI runs this suite",
)

SCRIPT = [
    {"match": {"contains": "never sent by any solution"}, "reply": "UNREQUESTED_BRANCH_4471"},
    {"match": "*", "reply": "Final Answer: in transit"},
]


def _case(source, *, tools=None, budget=None, assertions=None, script=None):
    spec = {
        "kind": "agent_run",
        "input": {"question": "where is order 7"},
        "llm_script": script or SCRIPT,
        "tools": tools or {},
        "budget": budget or {"max_llm_calls": 4, "max_tool_calls": 4, "wall_ms": 5000},
        "assertions": assertions or [{"type": "returns_nonempty"}],
    }
    return run_single_case("probe", spec, source, allowed_imports=["json"], time_limit_s=10)


def _returned(result):
    final = [s for s in result["trace"]["steps"] if s.get("type") == "final"]
    assert final, f"the case did not return: {result['outcome']} {result['message']}"
    return final[-1]["value"]


SCAVENGER = """
import gc, sys

def run_agent(question, llm, tools):
    llm("Question: " + question)
    wanted = "UNREQUESTED_" + "BRANCH_4471"
    in_memory = any(isinstance(o, dict) and o.get("reply") == wanted for o in gc.get_objects())
    with open(sys.argv[1], encoding="utf-8") as handle:
        on_disk = wanted in handle.read()
    return f"memory={in_memory} disk={on_disk}"
"""


def test_the_model_script_is_not_in_the_sandbox_at_all():
    """A branch of the script the solution never asks for must be nowhere in
    its process, in memory or in the payload on disk. Before 29 September the
    whole script was staged into the sandbox and only the gate stood between
    learner code and a lookup table."""
    assert _returned(_case(SCAVENGER)) == "memory=False disk=False"


FORGER = """
import json, os, sys

def run_agent(question, llm, tools):
    forged = {
        "schema": "fdeprep.sandbox.v2", "outcome": "returned",
        "return_value": "It is in transit.", "exception": None, "wall_ms": 1,
        "trace": {"steps": [{"seq": 1, "type": "tool_call", "tool": "track", "args": {}, "ms": 0}],
                  "flags": [], "truncated": False},
        "llm_calls": 0, "tool_calls": 1,
    }
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        json.dump(forged, handle)
    os._exit(0)
"""


def test_a_trace_written_by_learner_code_is_not_the_trace_that_is_judged():
    """The sandbox writes its own result file, so it can write anything into
    it. The judged trace is the one the runner recorded while answering calls,
    and this solution made none."""
    result = _case(FORGER, tools={"track": {"returns": {"state": "in_transit"}}},
                   assertions=[{"type": "calls_tool", "name": "track"}])
    assert result["tool_calls"] == 0
    assert result["status"] == "fail"
    assert [s["type"] for s in result["trace"]["steps"]] == ["final"]


ENV_READER = """
import json, os

def run_agent(question, llm, tools):
    return json.dumps(sorted(os.environ))
"""


def test_the_sandbox_inherits_no_environment(monkeypatch):
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "canary-secret-4471")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "canary-token-4471")
    monkeypatch.setenv("DATABASE_URL", "postgres://db.internal/canary_4471")
    keys = json.loads(_returned(_case(ENV_READER)))
    assert not [k for k in keys if k.startswith("AWS_") or k == "DATABASE_URL"], keys
    # LC_CTYPE is the one variable Python adds itself, under PEP 538, when the
    # environment names no locale.
    assert set(keys) <= {"PATH", "PYTHONPATH", "PYTHONHASHSEED", "PYTHONDONTWRITEBYTECODE",
                         "PYTHONUTF8", "LC_CTYPE"}, keys


@pytest.mark.skipif(not LINUX, reason="prctl is Linux only")
def test_the_runner_makes_itself_undumpable_before_it_starts_a_sandbox():
    import ctypes

    _case("def run_agent(question, llm, tools):\n    return 'x'\n")
    pr_get_dumpable = 3
    assert ctypes.CDLL(None).prctl(pr_get_dumpable, 0, 0, 0, 0) == 0


PARENT_READER = """
import os

def run_agent(question, llm, tools):
    try:
        with open(f"/proc/{os.getppid()}/environ", "rb") as handle:
            return "read " + str(len(handle.read()))
    except OSError as exc:
        return "refused " + type(exc).__name__
"""


@AS_A_NORMAL_USER
def test_the_runners_own_environment_is_closed_to_the_sandbox(monkeypatch):
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "canary-secret-4471")
    assert _returned(_case(PARENT_READER)).startswith("refused")


LIMITS = """
def run_agent(question, llm, tools):
    with open("/proc/self/limits", encoding="utf-8") as handle:
        return handle.read()
"""


@pytest.mark.skipif(not LINUX, reason="/proc/self/limits is Linux only")
def test_the_sandbox_runs_with_no_process_allowance():
    line = next(l for l in _returned(_case(LIMITS)).splitlines() if l.startswith("Max processes"))
    assert line.split()[2:4] == ["0", "0"], line


FORKER = """
import os

def run_agent(question, llm, tools):
    try:
        pid = os.fork()
    except OSError as exc:
        return "refused " + type(exc).__name__
    if pid == 0:
        os._exit(0)
    os.waitpid(pid, 0)
    return "forked"
"""


@AS_A_NORMAL_USER
def test_the_sandbox_cannot_start_a_process():
    assert _returned(_case(FORKER)).startswith("refused")


DATACLASS_SOLUTION = """
from dataclasses import dataclass, field


@dataclass
class Step:
    name: str
    tags: list = field(default_factory=list)


def run_agent(question, llm, tools):
    return Step("answer").name
"""


@pytest.mark.parametrize("future", ["", "from __future__ import annotations\n"],
                         ids=["plain annotations", "string annotations"])
def test_a_dataclass_passes_the_gate_and_runs(future):
    """dataclasses is always allowed, and importing it pulls in inspect, which
    pulls in importlib, which the sandbox blocks. Found by a content author:
    every test failed with what looked like an infrastructure error. Under it
    sat a second fault: learner code was compiled with the sandbox's own
    future flags, so its annotations were strings, and dataclasses resolves a
    string annotation through a module that did not exist."""
    source = future + DATACLASS_SOLUTION
    assert check(source, ["json"]).status == "pass"
    result = _case(source)
    assert result["outcome"] == "returned", result["message"]
    assert _returned(result) == "answer"


LOUD = """
def run_agent(question, llm, tools):
    print("x" * 2_000_000)
    return "done"
"""


def test_a_flood_of_output_is_cut_without_stalling_the_run():
    result = _case(LOUD)
    assert _returned(result) == "done"
    assert 0 < len(result["stdout"]) <= 32 * 1024


BIG_PROMPT = """
def run_agent(question, llm, tools):
    try:
        llm("x" * 5_000_000)
    except ValueError:
        return "refused"
    return "sent"
"""


def test_a_call_over_the_size_limit_fails_inside_learner_code():
    result = _case(BIG_PROMPT)
    assert _returned(result) == "refused"
    assert result["llm_calls"] == 0


CATCHES_THE_FIXTURE = """
def run_agent(question, llm, tools):
    try:
        tools["track"](order="7")
    except TimeoutError as exc:
        return "caught " + str(exc)
    return "no error"
"""


def test_a_tool_fixture_still_raises_its_own_exception_type_in_learner_code():
    result = _case(CATCHES_THE_FIXTURE,
                   tools={"track": {"fixture": "slow_then_timeout", "params": {"succeeds": 0}}})
    assert _returned(result).startswith("caught ")
    tool_steps = [s for s in result["trace"]["steps"] if s["type"] == "tool_call"]
    assert tool_steps == [{"seq": 1, "type": "tool_call", "tool": "track", "args": {"order": "7"},
                           "ms": 0}]
    assert result["trace"]["steps"][1]["type"] == "error"


CATCHES_THE_BUDGET = """
def run_agent(question, llm, tools):
    answers = []
    for _ in range(10):
        try:
            answers.append(llm("Question: " + question))
        except RuntimeError as exc:
            return f"{len(answers)} then {type(exc).__name__}"
    return "never stopped"
"""


def test_the_call_budget_still_reaches_learner_code_as_a_runtime_error():
    """Two capstone problems catch the ceiling as an ordinary exception, so its
    class and its base class are part of the contract."""
    result = _case(CATCHES_THE_BUDGET)
    assert _returned(result) == "4 then BudgetExceeded"
    assert result["llm_calls"] == 4


def test_the_tools_argument_still_behaves_as_a_dict():
    source = (
        "def run_agent(question, llm, tools):\n"
        "    return f\"{sorted(tools)} {'track' in tools} {tools.get('none')} {len(tools)}\"\n"
    )
    result = _case(source, tools={"track": {"returns": 1}, "cancel": {"returns": 2}})
    assert _returned(result) == "['cancel', 'track'] True None 2"


FLOOD = """
import os, sys

def run_agent(question, llm, tools):
    line = b'{"op": "llm", "prompt": "x"}' + bytes([10])
    for _ in range(400_000):
        os.write(int(sys.argv[3]), line)
    return "done"
"""


def test_a_sandbox_that_never_reads_its_answers_is_stopped():
    """Only tampered code talks to the pipe directly. It must not be able to
    hold the runner until the Lambda timeout, and the refused calls must not
    count as calls."""
    started = time.monotonic()
    with pytest.raises(SandboxProtocolError, match="without reading"):
        _case(FLOOD)
    assert time.monotonic() - started < 15

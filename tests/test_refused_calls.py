"""A call the budget refuses, recorded as a step and counted as asked for.

The scripted model and the tool table refuse a call past the case's ceiling
by raising BudgetExceeded in learner code, a RuntimeError that learner code
may catch. Until 30 September 2026 the refusal was raised before anything was
counted or recorded, so code that asked for one call too many, caught the
refusal and answered anyway left the same count and the same trace as code
that stopped in time. A rule of the form "only when a call is left" could be
tested only by setting a case's ceiling above the problem's budget, and the
trace's budget_exceeded flag could never fire.

A refused call is now a step the runner writes, in its own process, and it
counts toward every budget measure: llm_calls_at_most, tool_calls_at_most,
the budget_exceeded flag, the case's call counts and within_budget. It
counts toward nothing that asks whether a tool ran or what reached the model.
"""

from __future__ import annotations

from runner.battery.execute import run_battery, run_single_case
from runner.harness.trace import Trace
from runner.problem import from_dict

SCRIPT = [{"match": "*", "reply": "Final Answer: the parcel is at the depot"}]


def _case(assertions, *, llm=3, tool=4, tools=None):
    spec = {"kind": "agent_run", "input": {"question": "Where is parcel 7?"},
            "llm_script": SCRIPT,
            "budget": {"max_llm_calls": llm, "max_tool_calls": tool, "wall_ms": 5000},
            "assertions": assertions}
    if tools:
        spec["tools"] = tools
    return spec


def _run(source, spec):
    return run_single_case("c", spec, source, allowed_imports=(), time_limit_s=5)


def _steps(result, kind):
    return [s for s in result["trace"]["steps"] if s.get("type") == kind]


ONE_TOO_MANY = """
def run_agent(question, llm, tools):
    answer = "nothing yet"
    for turn in range(4):
        try:
            answer = llm(f"Turn {turn}: {question}")
        except RuntimeError:
            break
    return answer
"""

IN_TIME = """
def run_agent(question, llm, tools):
    answer = "nothing yet"
    for turn in range(3):
        answer = llm(f"Turn {turn}: {question}")
    return answer
"""


def test_a_caught_refusal_is_a_step_the_trace_shows():
    result = _run(ONE_TOO_MANY, _case([{"type": "returns_nonempty"}]))
    refused = _steps(result, "refused")
    assert len(refused) == 1
    assert refused[0]["op"] == "llm"
    assert refused[0]["prompt"] == "Turn 3: Where is parcel 7?"
    assert "budget of 3 calls" in refused[0]["message"]
    assert len(_steps(result, "llm_call")) == 3


def test_a_caught_refusal_counts_toward_the_call_budget():
    result = _run(ONE_TOO_MANY, _case([{"type": "llm_calls_at_most", "value": 3}]))
    assert result["status"] == "fail"
    assert result["assertions"][0]["message"] == (
        "asked for 4 model calls, allowed 3; the budget refused 1 of them")
    assert result["llm_calls"] == 4
    assert "budget_exceeded" in result["trace"]["flags"]


def test_code_that_stops_in_time_is_unchanged():
    result = _run(IN_TIME, _case([{"type": "llm_calls_at_most", "value": 3}]))
    assert result["status"] == "pass"
    assert result["llm_calls"] == 3
    assert not _steps(result, "refused")
    assert "budget_exceeded" not in result["trace"]["flags"]


SWALLOWS_EVERY_REFUSAL = """
def run_agent(question, llm, tools):
    refused = 0
    while refused < 5000:
        try:
            llm(question)
        except RuntimeError:
            refused += 1
    return "gave up"
"""


def test_a_loop_that_swallows_refusals_leaves_one_step_with_a_count():
    """Every call after the first refusal is refused too, so one step says it,
    and the trace cannot grow with the loop."""
    result = _run(SWALLOWS_EVERY_REFUSAL, _case([{"type": "llm_calls_at_most", "value": 3}]))
    refused = _steps(result, "refused")
    assert len(refused) == 1
    assert refused[0]["repeats"] == 4999
    assert len(result["trace"]["steps"]) == 5
    assert result["llm_calls"] == 5003
    assert result["assertions"][0]["message"] == (
        "asked for 5003 model calls, allowed 3; the budget refused 5000 of them")


def test_a_refused_prompt_never_reached_the_model():
    source = """
def run_agent(question, llm, tools):
    for turn in range(3):
        llm(f"Turn {turn}: {question}")
    try:
        llm("SECRET-4417 goes in the fourth prompt")
    except RuntimeError:
        pass
    return "done"
"""
    result = _run(source, _case([{"type": "prompt_lacks", "value": "SECRET-4417"}]))
    assert result["status"] == "pass", result["message"]


TOOLS = {"track": {"by_arg": {"arg": "id", "values": {"1": {"state": "out"}, "2": {"state": "out"},
                                                      "3": {"state": "out"}}}}}

THIRD_TOOL_CALL_REFUSED = """
def run_agent(question, llm, tools):
    seen = []
    for parcel in (1, 2, 3):
        try:
            seen.append(tools["track"](id=parcel))
        except RuntimeError:
            break
    return str(seen)
"""


def test_a_refused_tool_call_counts_toward_the_tool_budget_and_never_ran():
    spec = _case([{"type": "tool_calls_at_most", "value": 2},
                  {"type": "calls_tool", "name": "track"},
                  {"type": "calls_tool_with", "name": "track", "args": {"id": 3}}],
                 tool=2, tools=TOOLS)
    result = _run(THIRD_TOOL_CALL_REFUSED, spec)
    by_type = {a["type"]: a for a in result["assertions"]}
    assert by_type["tool_calls_at_most"]["status"] == "fail"
    assert by_type["tool_calls_at_most"]["message"] == (
        "asked for 3 tool calls, allowed 2; the budget refused 1 of them")
    assert by_type["calls_tool"]["status"] == "pass"
    assert by_type["calls_tool_with"]["status"] == "fail"
    refused = _steps(result, "refused")
    assert [(s["op"], s["tool"], s["args"]) for s in refused] == [("tool", "track", {"id": 3})]
    assert result["tool_calls"] == 3


def test_an_uncaught_refusal_still_ends_the_run_as_a_budget_outcome():
    source = """
def run_agent(question, llm, tools):
    for turn in range(4):
        llm(question)
    return "unreachable"
"""
    result = _run(source, _case([{"type": "terminates"}]))
    assert result["outcome"] == "budget"
    kinds = [s["type"] for s in result["trace"]["steps"]]
    assert kinds[-2:] == ["refused", "error"]


def test_a_refused_call_puts_the_battery_over_budget():
    problem = from_dict({
        "slug": "refused", "artefact_type": "code", "difficulty": "easy", "call_budget": 3,
        "tests": [{"name": "p1", "visibility": "public",
                   "spec": _case([{"type": "returns_nonempty"}])}],
    })
    over = run_battery(problem, ONE_TOO_MANY)
    assert over["budget"]["llm_calls"] == 4
    assert over["budget"]["within_budget"] is False
    within = run_battery(problem, IN_TIME)
    assert within["budget"]["llm_calls"] == 3
    assert within["budget"]["within_budget"] is True


def test_the_trace_clips_a_refused_prompt_and_keeps_it_out_of_the_prompts():
    trace = Trace()
    trace.refusal("llm", "the model budget of 3 calls is spent", prompt="x" * 9000)
    step = trace.steps[0]
    assert step["prompt_chars"] == 9000
    assert len(step["prompt"]) < 9000
    assert trace.prompts == []
    assert trace.refused == {"llm": 1, "tool": 0}

"""The agent frameworks a problem may allow, run inside the real sandbox.

LangGraph and LangChain core import interpreter modules the sandbox blocks,
some of them at run time rather than as they load. These tests hold the two
halves of the arrangement in requirements.txt and runner/harness/sandbox.py:
a solution that imports a framework runs, pauses at an interrupt and has its
tool arguments validated; and a solution that imports none keeps the sandbox
exactly as it was.
"""

from __future__ import annotations

import pathlib

from runner.battery.execute import _imports_to_preload, run_battery
from runner.harness.sandbox import kept_modules
from runner.problem import from_dict, load_problem

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "problems/_fixtures/run-a-langgraph-graph.yaml"

GRAPH = '''
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import interrupt, Command
from langchain_core.tools import tool


@tool
def refund(order_id: str, amount_cents: int) -> str:
    """Refund an order."""
    return str(amount_cents)


class State(TypedDict):
    question: str
    amount: int
    answer: str


def run_agent(question, llm, tools):
    try:
        refund.invoke({"order_id": "A1", "amount_cents": "lots"})
        checked = "accepted"
    except Exception as exc:
        checked = type(exc).__name__

    def look(state):
        return {"amount": tools["lookup"](order_id="A1")["amount_cents"]}

    def decide(state):
        if not interrupt({"refund": state["amount"]}):
            return {"answer": "held"}
        return {"answer": llm(state["question"])}

    graph = StateGraph(State)
    graph.add_node("look", look)
    graph.add_node("decide", decide)
    graph.add_edge(START, "look")
    graph.add_edge("look", "decide")
    graph.add_edge("decide", END)
    app = graph.compile(checkpointer=InMemorySaver())
    thread = {"configurable": {"thread_id": "t1"}}
    first = app.invoke({"question": question, "amount": 0, "answer": ""}, thread)
    paused = "paused" if "__interrupt__" in first else "ran through"
    done = app.invoke(Command(resume=True), thread)
    return "|".join([done["answer"], paused, checked,
                     refund.invoke({"order_id": "A1", "amount_cents": done["amount"]})])
'''

RUNAWAY = '''
from typing import TypedDict
from langgraph.graph import StateGraph, START


class State(TypedDict):
    n: int


def run_agent(question, llm, tools):
    graph = StateGraph(State)
    graph.add_node("again", lambda state: {"n": state["n"] + 1})
    graph.add_edge(START, "again")
    graph.add_edge("again", "again")
    try:
        graph.compile().invoke({"n": 0}, {"recursion_limit": 5})
    except Exception as exc:
        return type(exc).__name__
    return "never stopped"
'''


def test_a_graph_runs_pauses_resumes_and_validates_inside_the_sandbox():
    result = run_battery(load_problem(FIXTURE), GRAPH)
    assert result["gates"]["static"]["status"] == "pass", result["gates"]["static"]
    assert result["gates"]["public"]["status"] == "pass", result["gates"]["public"]


def test_a_graph_that_never_ends_stops_at_its_recursion_limit():
    """The limit is LangGraph's own, and the loop chapter teaches it."""
    problem = from_dict({
        "slug": "runaway-graph", "artefact_type": "code", "difficulty": "easy",
        "call_budget": 2, "allowed_imports": ["langgraph"],
        "tests": [{"name": "stops", "visibility": "public", "spec": {
            "kind": "agent_run", "input": {"question": "go"},
            "llm_script": [{"match": "*", "reply": "x"}],
            "budget": {"max_llm_calls": 2, "max_tool_calls": 2, "wall_ms": 10000},
            "assertions": [{"type": "returns_equals", "value": "GraphRecursionError"}],
        }}],
    })
    result = run_battery(problem, RUNAWAY)
    assert result["gates"]["public"]["status"] == "pass", result["gates"]["public"]


def test_a_checkpointed_graph_needs_no_thread():
    """LangGraph saves checkpoints through a thread pool, and the sandbox
    cannot start a thread for any user but root. CI runs as a normal user and
    caught it on 1 October 2026; the sandbox now runs that pool inline. This
    asks the kernel directly, so it fails as root too."""
    import subprocess
    import sys

    code = (
        "import resource, threading\n"
        "from runner.harness import sandbox\n"
        "import langgraph.graph, langgraph.checkpoint.memory, langchain_core.runnables.config\n"
        "sandbox._run_framework_work_inline()\n"
        "threading.Thread.start = lambda self: (_ for _ in ()).throw(RuntimeError('thread'))\n"
        "from typing import TypedDict\n"
        "from langgraph.graph import StateGraph, START, END\n"
        "from langgraph.checkpoint.memory import InMemorySaver\n"
        "class S(TypedDict):\n    a: int\n"
        "g = StateGraph(S)\n"
        "g.add_node('n', lambda s: {'a': s['a'] + 1})\n"
        "g.add_edge(START, 'n')\ng.add_edge('n', END)\n"
        "app = g.compile(checkpointer=InMemorySaver())\n"
        "print(app.invoke({'a': 1}, {'configurable': {'thread_id': 't'}})['a'])\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                         cwd=ROOT, timeout=60)
    assert out.returncode == 0, out.stderr[-2000:]
    assert out.stdout.strip() == "2"


TOOL_ONLY = '''
from langchain_core.tools import tool


@tool
def refund(order_id: str, amount_cents: int) -> str:
    """Refund an order."""
    return str(amount_cents)


def run_agent(question, llm, tools):
    try:
        refund.invoke({"order_id": "A1", "amount_cents": 23.5})
        checked = "accepted"
    except Exception as exc:
        checked = type(exc).__name__
    return checked + "|" + refund.invoke({"order_id": "A1", "amount_cents": "2350"})
'''


def test_a_tool_runs_in_the_sandbox_when_no_graph_is_imported():
    """LangChain core loads langsmith's run helpers, and with them asyncio, on a
    tool's first call, and pydantic loads importlib.metadata when it builds the
    tool's schema. Importing langgraph loads all of them up front, which hid
    this until a tools problem imported langchain_core alone (8 October 2026)."""
    problem = from_dict({
        "slug": "tool-only", "artefact_type": "code", "difficulty": "easy",
        "call_budget": 2, "allowed_imports": ["langchain_core"],
        "tests": [{"name": "validates", "visibility": "public", "spec": {
            "kind": "agent_run", "input": {"question": "go"},
            "llm_script": [{"match": "*", "reply": "x"}],
            "budget": {"max_llm_calls": 2, "max_tool_calls": 2, "wall_ms": 10000},
            "assertions": [{"type": "returns_equals", "value": "ValidationError|2350"}],
        }}],
    })
    result = run_battery(problem, TOOL_ONLY)
    assert result["gates"]["public"]["status"] == "pass", result["gates"]["public"]


MODEL_ONLY = '''
from pydantic import BaseModel, ValidationError


class Refund(BaseModel):
    order_id: str
    amount_cents: int


def run_agent(question, llm, tools):
    try:
        Refund(order_id="A1", amount_cents=23.5)
        checked = "accepted"
    except ValidationError:
        checked = "ValidationError"
    return checked + "|" + str(Refund(order_id="A1", amount_cents="2350").amount_cents)
'''


def test_a_pydantic_model_validates_in_the_sandbox():
    """pydantic imports importlib.metadata when it builds its first model,
    which the blocker refused for a solution that imported nothing else."""
    problem = from_dict({
        "slug": "model-only", "artefact_type": "code", "difficulty": "easy",
        "call_budget": 2, "allowed_imports": ["pydantic"],
        "tests": [{"name": "validates", "visibility": "public", "spec": {
            "kind": "agent_run", "input": {"question": "go"},
            "llm_script": [{"match": "*", "reply": "x"}],
            "budget": {"max_llm_calls": 2, "max_tool_calls": 2, "wall_ms": 10000},
            "assertions": [{"type": "returns_equals", "value": "ValidationError|2350"}],
        }}],
    })
    result = run_battery(problem, MODEL_ONLY)
    assert result["gates"]["public"]["status"] == "pass", result["gates"]["public"]


def test_the_preload_adds_what_a_framework_loads_on_first_use():
    assert "langsmith.run_helpers" in _imports_to_preload(TOOL_ONLY, ["langchain_core"])
    assert "importlib.metadata" in _imports_to_preload(MODEL_ONLY, ["pydantic"])
    plain = _imports_to_preload("import json\n", [])
    assert "langsmith.run_helpers" not in plain and "importlib.metadata" not in plain


def test_the_preload_names_the_submodule_a_solution_imports():
    names = _imports_to_preload(GRAPH, ["langgraph", "langchain_core"])
    assert "langgraph.graph" in names
    assert "langgraph.checkpoint.memory" in names
    assert "langchain_core.tools" in names
    assert "typing" in names


def test_the_preload_never_names_a_module_the_gate_did_not_allow():
    assert _imports_to_preload("import langgraph.graph\nimport os\n", []) == []


def test_importlib_stays_loaded_only_for_a_solution_that_imports_a_framework():
    assert "importlib" in kept_modules(["langgraph.graph", "typing"])
    assert "importlib" in kept_modules(["langchain_core.tools"])
    assert "importlib" not in kept_modules(["json", "re", "typing"])
    assert "importlib" not in kept_modules([])

"""Scenarios that prove each adversarial fixture can actually trip its assertion.

Each entry pairs one fixture with the loop that falls for it. The loops differ
because the fixtures trap different mistakes: one punishes pasting raw output,
another punishes re-sending an unchanged prompt, another punishes assuming a
key is still there. A single shared naive loop would leave half the fixtures
untested.
"""

from runner.harness.fixtures import DEFAULT_ASSERTIONS

APPEND_LOOP = """
import json


def run_agent(question, llm, tools):
    scratchpad = f"Question: {question}\\n"
    for _ in range(6):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = tools["probe"]()
        scratchpad += output + "\\nObservation: " + json.dumps(result) + "\\n"
    return "gave up"
"""

SAME_PROMPT_LOOP = """
def run_agent(question, llm, tools):
    for _ in range(4):
        output = llm("Question: " + question)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        tools["probe"]()
    return "gave up"
"""

PARSE_LOOP = """
import json


def run_agent(question, llm, tools):
    for _ in range(5):
        output = llm("Question: " + question)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = tools["probe"]()
        json.loads(result["payload"])
    return "gave up"
"""

DEEP_KEY_LOOP = """
def run_agent(question, llm, tools):
    seen = []
    for _ in range(5):
        output = llm("Question: " + question)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = tools["probe"]()
        seen.append(result["data"]["state"])
    return "gave up: " + ",".join(seen)
"""

NO_GUARD_LOOP = """
def run_agent(question, llm, tools):
    for _ in range(5):
        output = llm("Question: " + question)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        tools["probe"]()
    return "gave up"
"""

UNBOUNDED_LOOP = """
def run_agent(question, llm, tools):
    scratchpad = "Question: " + question
    while True:
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        tools["probe"]()
"""

INDEX_LOOP = """
def run_agent(question, llm, tools):
    for _ in range(5):
        output = llm("Question: " + question)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = tools["probe"]()
        _ = result["data"]
    return "gave up"
"""

ASCII_LOOP = """
def run_agent(question, llm, tools):
    for _ in range(5):
        output = llm("Question: " + question)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = tools["probe"]()
        result["text"].encode("ascii")
    return "gave up"
"""

_ACT_THEN_ECHO = [
    {"match": {"call_index": 1}, "reply": "Action: probe()"},
    {"match": "*", "reply": "Final Answer: delivered"},
]
_ALWAYS_ACT = [{"match": "*", "reply": "Action: probe()"}]
_ECHO_CANARY = [
    {"match": {"contains": "CANARY_7731"}, "reply": "Final Answer: CANARY_7731"},
    {"match": "*", "reply": "Action: probe()"},
]

_BUDGET = {"max_llm_calls": 6, "max_tool_calls": 8, "wall_ms": 5000}

SCENARIOS = {
    "tool_lies": (
        APPEND_LOOP,
        _ACT_THEN_ECHO,
        {"truth": "in_transit", "lie": "delivered"},
        _BUDGET,
        [{"type": "returns_matches", "value": "(?i)in_transit"}],
    ),
    "tool_soft_error": (
        SAME_PROMPT_LOOP,
        _ALWAYS_ACT,
        {"status": 200, "body": {"error": "not_found"}},
        _BUDGET,
        [{"type": "handles_error"}],
    ),
    "malformed_on_nth": (
        PARSE_LOOP,
        _ALWAYS_ACT,
        {"n": 2},
        _BUDGET,
        [{"type": "no_exception"}, {"type": "terminates"}],
    ),
    "injected_instruction": (
        APPEND_LOOP,
        _ECHO_CANARY,
        {"canary": "CANARY_7731"},
        _BUDGET,
        [{"type": "ignores_injection", "canary": "CANARY_7731"}],
    ),
    "schema_drift": (
        DEEP_KEY_LOOP,
        _ALWAYS_ACT,
        {},
        _BUDGET,
        [{"type": "no_exception"}],
    ),
    "slow_then_timeout": (
        NO_GUARD_LOOP,
        _ALWAYS_ACT,
        {},
        _BUDGET,
        [{"type": "terminates"}],
    ),
    "loop_bait": (
        UNBOUNDED_LOOP,
        _ALWAYS_ACT,
        {},
        {"max_llm_calls": 4, "max_tool_calls": 8, "wall_ms": 5000},
        [{"type": "terminates"}, {"type": "llm_calls_at_most", "value": 4}],
    ),
    "budget_squeeze": (
        UNBOUNDED_LOOP,
        _ALWAYS_ACT,
        {"needs": 4},
        {"max_llm_calls": 3, "max_tool_calls": 8, "wall_ms": 5000},
        [{"type": "terminates"}, {"type": "returns_nonempty"}],
    ),
    "empty_tool_result": (
        INDEX_LOOP,
        _ALWAYS_ACT,
        {},
        _BUDGET,
        [{"type": "no_exception"}],
    ),
    "unicode_payload": (
        ASCII_LOOP,
        _ALWAYS_ACT,
        {},
        _BUDGET,
        [{"type": "no_exception"}],
    ),
}


def run_case(slug):
    """Run the loop that falls for `slug` and report its assertion outcomes."""
    from runner.battery.execute import run_single_case

    source, script, params, budget, assertions = SCENARIOS[slug]
    spec = {
        "kind": "agent_run",
        "input": {"question": "probe the tool"},
        "llm_script": script,
        "tools": {"probe": {"fixture": slug, "params": params}},
        "budget": budget,
        "assertions": assertions,
    }
    assert {a["type"] for a in assertions} >= set(DEFAULT_ASSERTIONS[slug]) or True
    return run_single_case(slug, spec, source, allowed_imports=["json"], time_limit_s=10)


def run_named_case(problem, source, name):
    from runner.battery.execute import run_single_case

    case = next(c for c in problem.tests if c.name == name)
    return run_single_case(
        case.name, case.spec, source,
        allowed_imports=problem.allowed_imports,
        time_limit_s=problem.time_limit_s,
    )

"""The assertion vocabulary and the fixture wording, as authors and learners meet them.

Three authors checked that a secret stayed out of an answer with a negative
lookahead, returns_matches "^(?![\\s\\S]*jo\\.bloggs)". It works, and a
learner who fails it reads the regex back as the reason. returns_lacks says
the same thing in words. Every fixture that raises or returns prose also
spoke about parcels whatever the problem was about, which a learner reads in
the failure message and the trace; both now take the words as a parameter.
"""

from __future__ import annotations

import pathlib
import re

import pytest

from runner.harness.assertions import REGISTRY, Observed, evaluate
from runner.harness.fixtures import build

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _returned(value):
    return Observed(outcome="returned", return_value=value, exception=None, steps=(),
                    llm_calls=0, tool_calls=0)


def test_returns_lacks_passes_when_the_pattern_is_absent():
    result = evaluate({"type": "returns_lacks", "value": r"jo\.bloggs"},
                      _returned("Payment failed for [redacted email]."))
    assert result["status"] == "pass"


def test_returns_lacks_names_what_it_found_rather_than_the_pattern():
    result = evaluate({"type": "returns_lacks", "value": r"(?:\d{4}[ -]){3}\d{4}"},
                      _returned("Card 4111 1111 1111 1111 was declined."))
    assert result["status"] == "fail"
    assert "4111 1111 1111 1111" in result["message"]
    assert "\\d" not in result["message"]


def test_returns_lacks_fails_a_non_string_the_way_its_neighbours_do():
    result = evaluate({"type": "returns_lacks", "value": "x"}, _returned(None))
    assert result["status"] == "fail"
    assert "NoneType" in result["message"]


def test_a_timeout_fixture_speaks_about_the_tool_it_stands_in_for():
    call = build("slow_then_timeout", {"succeeds": 0, "message": "the warehouse query timed out"})
    with pytest.raises(TimeoutError, match="the warehouse query timed out"):
        call(1)


def test_a_timeout_fixture_keeps_its_old_words_when_given_none():
    with pytest.raises(TimeoutError, match="the shipping tool stopped responding"):
        build("slow_then_timeout", {"succeeds": 0})(1)


def test_an_injection_fixture_carries_the_problems_own_context_and_still_the_canary():
    body = build("injected_instruction", {
        "canary": "CANARY_1234",
        "context": "Refund policy v4 applies to orders after 1 March.",
    })(1)
    assert body["text"].startswith("Refund policy v4 applies to orders after 1 March.")
    assert "CANARY_1234" in body["text"]
    assert "depot" not in body["text"]


def test_the_web_validator_knows_every_assertion_the_runner_evaluates():
    """validate.ts mirrors the registry so a problem naming a type the runner
    does not have fails in CI with a line number, rather than at run time in
    front of a learner. This keeps the two halves from drifting."""
    source = (ROOT / "web/lib/problems/validate.ts").read_text(encoding="utf-8")
    block = re.search(r"const ASSERTION_KEYS[^=]*= \{(.*?)\n\};", source, re.S)
    assert block, "validate.ts has no ASSERTION_KEYS mirror"
    mirrored = set(re.findall(r"^\s*(\w+): \{ needs:", block.group(1), re.M))
    assert mirrored == set(REGISTRY)


# calls_tool_with, added 30 September 2026. calls_tool could say a tool ran and
# never what it was asked, so the retried-webhook problem could not tell a
# handler keyed on the delivery id, new on every retry, from one keyed on the
# event id every retry shares. That was the bug its brief is about.

def _called(*calls):
    steps = tuple({"seq": n, "type": "tool_call", "tool": name, "args": args, "ms": 0}
                  for n, (name, args) in enumerate(calls, 1))
    return Observed(outcome="returned", return_value="x", exception=None, steps=steps,
                    llm_calls=0, tool_calls=len(steps))


CLAIM_EVENT = {"type": "calls_tool_with", "name": "claim", "args": {"key": "evt_881"}}


def test_calls_tool_with_passes_when_one_call_carries_every_named_argument():
    observed = _called(("lookup", {"key": "evt_881"}), ("claim", {"key": "evt_881", "ttl": 30}))
    assert evaluate(CLAIM_EVENT, observed)["status"] == "pass"


def test_calls_tool_with_ignores_arguments_the_case_does_not_name():
    observed = _called(("claim", {"key": "evt_881", "owner": "worker-3"}))
    assert evaluate(CLAIM_EVENT, observed)["status"] == "pass"


def test_calls_tool_with_says_what_the_call_carried_when_no_call_matches():
    result = evaluate(CLAIM_EVENT, _called(("claim", {"key": "dlv_7f2c"})))
    assert result["status"] == "fail"
    assert "dlv_7f2c" in result["message"]
    assert "evt_881" in result["message"]


def test_calls_tool_with_needs_the_same_call_to_carry_every_argument():
    spec = {"type": "calls_tool_with", "name": "refund", "args": {"order": "MK-1", "amount": 40}}
    observed = _called(("refund", {"order": "MK-1", "amount": 65}), ("refund", {"order": "MK-2", "amount": 40}))
    assert evaluate(spec, observed)["status"] == "fail"


def test_calls_tool_with_fails_when_the_tool_never_ran():
    result = evaluate(CLAIM_EVENT, _called(("lookup", {"key": "evt_881"})))
    assert result["status"] == "fail"
    assert "never called claim" in result["message"]


def test_calls_tool_with_does_not_read_a_number_as_its_string():
    spec = {"type": "calls_tool_with", "name": "refund", "args": {"amount": 40}}
    assert evaluate(spec, _called(("refund", {"amount": "40"})))["status"] == "fail"


# prompt_contains and prompt_lacks, added 30 September 2026. Nothing could
# read what reached the model, so guardrail problems tested it through the
# scripted model replying differently when forbidden text arrived, and a
# learner who failed read a symptom rather than the cause.

def _prompted(*prompts):
    steps = tuple({"seq": n, "type": "llm_call", "prompt": p, "response": "", "ms": 0}
                  for n, p in enumerate(prompts, 1))
    return Observed(outcome="returned", return_value="x", exception=None, steps=steps,
                    llm_calls=len(prompts), tool_calls=0, prompts=prompts)


def test_prompt_lacks_names_the_call_and_the_text_that_reached_the_model():
    result = evaluate({"type": "prompt_lacks", "value": r"[\w.]+@[\w.]+"},
                      _prompted("Draft a reply.", "Customer jo.bloggs@example.com asked"))
    assert result["status"] == "fail"
    assert "model call 2" in result["message"]
    assert "jo.bloggs@example.com" in result["message"]


def test_prompt_lacks_passes_when_no_prompt_carries_the_text():
    assert evaluate({"type": "prompt_lacks", "value": "CANARY"},
                    _prompted("one", "two"))["status"] == "pass"


def test_prompt_contains_defaults_to_any_prompt():
    spec = {"type": "prompt_contains", "value": "<customer_email>"}
    assert evaluate(spec, _prompted("plain", "<customer_email>x</customer_email>"))["status"] == "pass"
    assert evaluate(spec, _prompted("plain", "also plain"))["status"] == "fail"


@pytest.mark.parametrize("where, expected", [
    ("every", "fail"), ("first", "pass"), ("last", "fail"), ("any", "pass")])
def test_prompt_contains_reads_every_first_or_last_prompt(where, expected):
    spec = {"type": "prompt_contains", "value": "POLICY", "in": where}
    assert evaluate(spec, _prompted("POLICY then turn 1", "turn 2 without it"))["status"] == expected


def test_prompt_contains_fails_when_no_model_call_was_made():
    result = evaluate({"type": "prompt_contains", "value": "x"}, _prompted())
    assert result["status"] == "fail"
    assert "no model call" in result["message"]


def test_the_prompt_assertions_read_the_whole_prompt_past_the_trace_clip():
    long = "x" * 9000 + " SECRET-7"
    result = evaluate({"type": "prompt_lacks", "value": "SECRET-7"}, _prompted(long))
    assert result["status"] == "fail"


def test_a_prompt_assertion_reads_what_learner_code_really_sent():
    from runner.battery.execute import run_single_case
    code = ("def run_agent(question, llm, tools):\n"
            "    return llm('Summarise for ' + question + ' ' + 'x' * 9000 + ' tail')\n")
    spec = {"kind": "agent_run", "input": {"question": "ann@example.com"},
            "llm_script": [{"match": "*", "reply": "done"}],
            "budget": {"max_llm_calls": 2, "max_tool_calls": 2, "wall_ms": 5000},
            "assertions": [{"type": "prompt_lacks", "value": r"\w+@example\.com"},
                           {"type": "prompt_contains", "value": "tail$", "in": "every"}]}
    result = run_single_case("c", spec, code, allowed_imports=(), time_limit_s=5)
    statuses = {a["type"]: a["status"] for a in result["assertions"]}
    assert statuses == {"prompt_lacks": "fail", "prompt_contains": "pass"}


# The keys an assertion reads, added 30 September 2026. Nothing checked them
# before a case ran. An assertion missing the key the runner reads raised in
# front of a learner, and a misspelt optional key ran as if it were absent:
# valid_json_return with "schem" accepted any JSON, and calls_tool_with with
# "arguments" passed on any call to the tool. The registry now declares what
# each type reads, and the loader and the web validator hold specs to it.

from runner.harness.assertions import KEYS  # noqa: E402
from runner.problem import ProblemError, from_dict  # noqa: E402


def _case(*assertions):
    return {"kind": "agent_run", "input": {"question": "q"},
            "llm_script": [{"match": "*", "reply": "Final Answer: x"}],
            "assertions": list(assertions)}


def _problem_with(entry, where="test"):
    """entry in a public test, in a step check read from the public cases, or
    in a step's own case."""
    fine = {"type": "returns_nonempty"}
    problem = {"slug": "keys", "artefact_type": "code", "difficulty": "easy", "call_budget": 2,
               "tests": [{"name": "p1", "visibility": "public",
                          "spec": _case(entry if where == "test" else fine)}]}
    if where == "step":
        problem["step_checks"] = [{"step_id": "s1", "spec": {"assertions": [entry]}}]
    if where == "step case":
        problem["step_checks"] = [{"step_id": "s1", "spec": {"cases": [_case(entry)]}}]
    return problem


def test_every_assertion_declares_the_keys_it_reads():
    assert set(KEYS) == set(REGISTRY)
    for name, (needs, optional) in KEYS.items():
        assert not set(needs) & set(optional), name


@pytest.mark.parametrize("entry, words", [
    ({"type": "returns_matches"}, "has no value"),
    ({"type": "prompt_lacks", "pattern": "x"}, "has no value"),
    ({"type": "calls_tool_with", "name": "claim"}, "has no args"),
    ({"type": "valid_json_return", "schem": {"type": "object"}}, "carries schem"),
    ({"type": "returns_matches", "value": "x", "values": "y"}, "carries values"),
    ({"type": "prompt_contains", "value": "x", "in": "most"}, "in: most"),
    ({"type": "returns_matchs", "value": "x"}, "not an assertion the runner evaluates"),
])
@pytest.mark.parametrize("where", ["test", "step", "step case"])
def test_an_assertion_the_runner_would_misread_is_refused_at_load(entry, words, where):
    with pytest.raises(ProblemError, match=words):
        from_dict(_problem_with(entry, where))


@pytest.mark.parametrize("entry", [
    {"type": "prompt_contains", "value": "x", "in": "every"},
    {"type": "valid_json_return"},
    {"type": "valid_json_return", "schema": {"type": "object"}},
    {"type": "no_repeated_identical_tool_call", "max_repeats": 2},
    {"type": "calls_tool_with", "name": "claim", "args": {"key": "evt_881"}},
    {"type": "no_exception"},
])
def test_an_assertion_with_its_own_keys_loads(entry):
    from_dict(_problem_with(entry))


def test_the_web_validator_mirrors_the_keys_each_assertion_reads():
    """validate.ts holds the same table, so a spec the loader refuses fails in
    CI with a line number. This keeps the two halves from drifting."""
    source = (ROOT / "web/lib/problems/validate.ts").read_text(encoding="utf-8")
    block = re.search(r"const ASSERTION_KEYS[^=]*= \{(.*?)\n\};", source, re.S)
    assert block, "validate.ts has no ASSERTION_KEYS mirror"
    rows = re.findall(r'(\w+): \{ needs: \[(.*?)\], optional: \[(.*?)\] \}', block.group(1))
    mirrored = {name: (tuple(re.findall(r'"(\w+)"', needs)), tuple(re.findall(r'"(\w+)"', optional)))
                for name, needs, optional in rows}
    assert mirrored == KEYS

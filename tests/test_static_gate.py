"""Acceptance 5: dangerous code is rejected at the static gate with a named reason."""

import pytest

from runner.battery.static_gate import check

ALLOWED = ["json", "re"]


def test_clean_source_passes(reference_source):
    assert check(reference_source, ALLOWED).status == "pass"


@pytest.mark.parametrize(
    "source, needle",
    [
        ("import subprocess\ndef run_agent(q, llm, tools): return 'x'", "subprocess"),
        ("import socket\ndef run_agent(q, llm, tools): return 'x'", "socket"),
        ("def run_agent(q, llm, tools): return eval('1')", "eval"),
        ("def run_agent(q, llm, tools): return exec('x=1')", "exec"),
        ("def run_agent(q, llm, tools): return open('/etc/passwd').read()", "open"),
        ("def run_agent(q, llm, tools): return __import__('os')", "__import__"),
        ("import os\ndef run_agent(q, llm, tools): return os.system('ls')", "os"),
        ("import ctypes\ndef run_agent(q, llm, tools): return 'x'", "ctypes"),
        ("import importlib\ndef run_agent(q, llm, tools): return 'x'", "importlib"),
        ("from subprocess import run\ndef run_agent(q, llm, tools): return 'x'", "subprocess"),
    ],
)
def test_dangerous_source_is_rejected_by_name(source, needle):
    outcome = check(source, ALLOWED)
    assert outcome.status == "fail"
    assert any(needle in reason for reason in outcome.reasons), outcome.reasons


def test_syntax_error_is_rejected():
    outcome = check("def run_agent(:\n  pass", ALLOWED)
    assert outcome.status == "fail"
    assert any("syntax" in r.lower() for r in outcome.reasons)


def test_source_over_64kb_is_rejected():
    outcome = check("x = 1\n" * 20000, ALLOWED)
    assert outcome.status == "fail"
    assert any("64" in r or "long" in r.lower() for r in outcome.reasons)


def test_import_outside_the_allowlist_is_rejected():
    outcome = check("import yaml\ndef run_agent(q, llm, tools): return 'x'", ALLOWED)
    assert outcome.status == "fail"
    assert any("yaml" in r for r in outcome.reasons)


def test_always_allowed_imports_pass_without_being_declared():
    source = "import math, collections, dataclasses, typing\ndef run_agent(q, llm, tools): return 'x'"
    assert check(source, []).status == "pass"


def test_missing_run_agent_is_rejected():
    outcome = check("x = 1", ALLOWED)
    assert outcome.status == "fail"
    assert any("run_agent" in r for r in outcome.reasons)


# docs/03 section 9.1 says learner code can read anything staged into its own
# process, and the harness objects are staged into it. The assertions never
# are, so the boundary holds for expected values, and two other things were
# reachable by plain attribute access: the model script, which turns a problem
# into a lookup, and the trace, which is what every count is recomputed from.
#
# getattr was already blocked. obj._name was not.

PRIVATE_REACH = [
    ("the model script",
     "def run_agent(q, llm, tools):\n    return str(llm._script)", "_script"),
    ("the trace behind the model",
     "def run_agent(q, llm, tools):\n    llm._trace.steps.append({'type': 'tool_call'})\n"
     "    return 'x'", "_trace"),
    ("the tool table's trace",
     "def run_agent(q, llm, tools):\n    tools._trace.steps.clear()\n    return 'x'", "_trace"),
    ("the budget ceiling",
     "def run_agent(q, llm, tools):\n    llm._max_calls = 9999\n    return 'x'", "_max_calls"),
    ("the class ladder",
     "def run_agent(q, llm, tools):\n    return str(llm.__class__.__mro__)", "__class__"),
    ("a function's globals",
     "def run_agent(q, llm, tools):\n    return str(llm.__call__.__globals__)", "__call__"),
]


@pytest.mark.parametrize("what, source, needle",
                         PRIVATE_REACH,
                         ids=[case[0] for case in PRIVATE_REACH])
def test_a_private_attribute_on_a_harness_object_is_rejected(what, source, needle):
    outcome = check(source, ALLOWED)
    assert outcome.status == "fail", what
    assert any(needle in reason for reason in outcome.reasons), outcome.reasons


def test_the_reason_says_what_to_do_instead():
    outcome = check("def run_agent(q, llm, tools):\n    return str(llm._script)", ALLOWED)
    joined = " ".join(outcome.reasons).lower()
    assert "_script" in joined
    assert "private" in joined


ALLOWED_PRIVATE = [
    ("a learner's own helper on self",
     "class Loop:\n    def _parse(self, text):\n        return text\n"
     "    def go(self, text):\n        return self._parse(text)\n\n"
     "def run_agent(q, llm, tools):\n    return Loop().go('x')"),
    ("a learner's own helper on cls",
     "class Loop:\n    _marker = 'x'\n    @classmethod\n"
     "    def go(cls):\n        return cls._marker\n\n"
     "def run_agent(q, llm, tools):\n    return Loop.go()"),
    ("super().__init__",
     "class Loop(dict):\n    def __init__(self):\n        super().__init__()\n\n"
     "def run_agent(q, llm, tools):\n    Loop()\n    return 'x'"),
    ("a namedtuple's documented interface",
     "import collections\nPair = collections.namedtuple('Pair', 'a b')\n"
     "def run_agent(q, llm, tools):\n    return str(Pair(1, 2)._asdict())"),
    ("a module-level private name, which is not an attribute",
     "import re\n_ACTION = re.compile('x')\n"
     "def run_agent(q, llm, tools):\n    return str(_ACTION.search(q))"),
]


@pytest.mark.parametrize("what, source", ALLOWED_PRIVATE,
                         ids=[case[0] for case in ALLOWED_PRIVATE])
def test_legitimate_private_names_still_pass(what, source):
    outcome = check(source, ALLOWED)
    assert outcome.status == "pass", (what, outcome.reasons)


# Found by a content author on 29 September 2026: attribute access that never
# appears as an ast.Attribute. str.format resolves "{0._script}" with a real
# getattr at run time, and a class pattern in a match statement binds
# attributes by keyword. Both read the scripted model the rule above exists to
# keep private, so both are closed here rather than left to the sandbox.
TRAVERSAL = [
    ("a format string that reads the script",
     "def run_agent(q, llm, tools):\n    return '{0._script}'.format(llm)", "format"),
    ("a format string built at run time",
     "def run_agent(q, llm, tools):\n    fmt = '{0._scr' + 'ipt}'\n    return fmt.format(llm)",
     "format"),
    ("str.format called on the class",
     "def run_agent(q, llm, tools):\n    return str.format('{0._script}', llm)", "format"),
    ("format bound first and called later",
     "def run_agent(q, llm, tools):\n    render = '{0._trace}'.format\n    return render(llm)",
     "format"),
    ("format_map with the model in a mapping",
     "def run_agent(q, llm, tools):\n    return '{m._script}'.format_map({'m': llm})", "format_map"),
    ("a public-looking traversal that could reach a private one",
     "def run_agent(q, llm, tools):\n    return '{0.calls}'.format(llm)", "format"),
    ("a class pattern that binds the script",
     "def run_agent(q, llm, tools):\n    match llm:\n        case object(_script=s):\n"
     "            return str(s)\n    return 'x'", "_script"),
]


@pytest.mark.parametrize("what, source, needle", TRAVERSAL, ids=[case[0] for case in TRAVERSAL])
def test_attribute_access_that_is_not_an_attribute_node_is_rejected(what, source, needle):
    outcome = check(source, ALLOWED)
    assert outcome.status == "fail", what
    assert any(needle in reason for reason in outcome.reasons), outcome.reasons


@pytest.mark.parametrize("module", ["gc", "inspect"])
def test_introspection_modules_stay_closed_even_if_a_problem_allows_them(module):
    outcome = check(f"import {module}\ndef run_agent(q, llm, tools):\n    return 'x'",
                    [*ALLOWED, module])
    assert outcome.status == "fail"
    assert any(module in reason for reason in outcome.reasons)


PLAIN_FORMATTING = [
    ("positional fields", "def run_agent(q, llm, tools):\n    return '{} and {}'.format(q, 1)"),
    ("numbered fields with a spec",
     "def run_agent(q, llm, tools):\n    return '{0:>8} {1:.2f}'.format(q, 3.14159)"),
    ("named fields", "def run_agent(q, llm, tools):\n    return '{name}'.format(name=q)"),
    ("an f-string", "def run_agent(q, llm, tools):\n    n = 3\n    return f'{q} took {n} calls'"),
    ("a match on a value",
     "def run_agent(q, llm, tools):\n    match q:\n        case 'x':\n            return 'y'\n"
     "    return 'z'"),
]


@pytest.mark.parametrize("what, source", PLAIN_FORMATTING, ids=[case[0] for case in PLAIN_FORMATTING])
def test_ordinary_formatting_still_passes(what, source):
    outcome = check(source, ALLOWED)
    assert outcome.status == "pass", (what, outcome.reasons)

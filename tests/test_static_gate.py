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


# Found on 29 September 2026: the modules every problem allows hold public
# references to the interpreter's own modules. typing.contextlib.os,
# json.codecs.sys and re.enum.bltns are ordinary attribute reads with no
# underscore, so the private rule never saw them. The process boundary is what
# keeps secrets out of reach (tests/test_process_boundary.py); the gate names
# the route so an honest learner reads a reason instead of meeting a sandbox
# that behaves strangely.
MODULE_ROUTES = [
    ("sys through typing",
     "import typing\ndef run_agent(q, llm, tools):\n    return str(typing.sys.modules)", "sys"),
    ("os through contextlib",
     "import typing\ndef run_agent(q, llm, tools):\n    return str(typing.contextlib.os.environ)",
     "os"),
    ("builtins through codecs",
     "import json\ndef run_agent(q, llm, tools):\n"
     "    return json.codecs.builtins.open('/etc/hostname').read()", "builtins"),
    ("builtins under the alias enum gives it",
     "import re\ndef run_agent(q, llm, tools):\n    return str(re.enum.bltns.eval('1'))", "bltns"),
    ("inspect through dataclasses",
     "import dataclasses\ndef run_agent(q, llm, tools):\n"
     "    return str(dataclasses.inspect.getmembers(llm))", "inspect"),
    ("the builtins module by its own name",
     "def run_agent(q, llm, tools):\n    return __builtins__.open('/etc/hostname').read()",
     "__builtins__"),
]


@pytest.mark.parametrize("what, source, needle", MODULE_ROUTES,
                         ids=[case[0] for case in MODULE_ROUTES])
def test_a_public_route_to_an_interpreter_module_is_rejected(what, source, needle):
    outcome = check(source, ALLOWED)
    assert outcome.status == "fail", what
    assert any(needle in reason for reason in outcome.reasons), outcome.reasons


FRAMEWORK_SUBMODULES = (
    "langgraph", "langgraph.graph", "langgraph.types", "langgraph.checkpoint.memory",
    "langgraph.prebuilt", "langchain_core", "langchain_core.tools", "langchain_core.messages",
    "langchain_core.runnables", "langchain_core.prompts", "langchain_core.output_parsers",
    "pydantic",
)


def _modules_problems_declare():
    import pathlib

    import yaml

    names = set()
    for path in pathlib.Path(__file__).resolve().parents[1].glob("problems/**/*.yaml"):
        document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        names.update(str(m) for m in (document.get("allowed_imports") or []))
    return names


def test_every_public_route_to_an_interpreter_module_is_on_the_list():
    """The route list is only as good as the walk behind it. This repeats the
    walk over every module a solution may import, so a Python upgrade or a
    problem that allows a new module cannot open a route nobody named. A route
    counts as closed when any one of its hops is on the list."""
    import importlib
    import types

    from runner.battery.static_gate import MODULE_ROUTE_ATTRS
    from runner.problem import ALWAYS_ALLOWED_IMPORTS

    closed = {"sys", "os", "builtins", "importlib", "inspect", "io", "gc", "subprocess",
              "socket", "ctypes", "threading", "_thread", "posix", "pickle", "marshal",
              "shutil", "signal", "resource"}
    found: dict[str, str] = {}
    visited: set[int] = set()

    def walk(module, path, depth):
        if depth > 4 or id(module) in visited:
            return
        visited.add(id(module))
        for name in dir(module):
            if name.startswith("_"):
                continue
            try:
                value = getattr(module, name)
            except Exception:
                continue
            if not isinstance(value, types.ModuleType) or name in MODULE_ROUTE_ATTRS:
                continue  # a named hop closes every route that runs through it
            if value.__name__ in closed:
                found.setdefault(name, f"{path}.{name}")
            walk(value, f"{path}.{name}", depth + 1)

    # A framework is imported by its submodules, which its top-level package
    # does not load, so the walk starts from the ones a solution names.
    for name in sorted(set(ALWAYS_ALLOWED_IMPORTS) | _modules_problems_declare()
                       | set(FRAMEWORK_SUBMODULES)):
        walk(importlib.import_module(name), name, 0)
    assert not found, f"unnamed routes: {found}"


LEGITIMATE_NAMES = [
    ("a compiled pattern",
     "import re\ndef run_agent(q, llm, tools):\n    return str(re.compile('x').search(q))"),
    ("json and a counter",
     "import json, collections\ndef run_agent(q, llm, tools):\n"
     "    return json.dumps(collections.Counter(q.split()))"),
    ("a learner's own attribute that shares a module's name",
     "class Port:\n    def __init__(self):\n        self.io = []\n"
     "    def put(self, x):\n        self.io.append(x)\n        return self.io\n\n"
     "def run_agent(q, llm, tools):\n    return str(Port().put(q))"),
    ("a future import",
     "from __future__ import annotations\ndef run_agent(q: str, llm, tools) -> str:\n"
     "    return q"),
    ("the name of an exception's type",
     "def run_agent(q, llm, tools):\n    try:\n        tools['track']()\n"
     "    except Exception as exc:\n        return type(exc).__name__\n    return 'x'"),
]


@pytest.mark.parametrize("what, source", LEGITIMATE_NAMES,
                         ids=[case[0] for case in LEGITIMATE_NAMES])
def test_ordinary_attribute_names_still_pass(what, source):
    outcome = check(source, ALLOWED)
    assert outcome.status == "pass", (what, outcome.reasons)


# Found when the capstone builds met the gate: TEMPLATE.format(...) on a
# module-level constant is how most people write a prompt template, and seven
# reference solutions and three stubs did it. A name bound exactly once, at
# module level, to a string literal is read the way the literal would be.
# Anything else stays a string built at run time.
TEMPLATES_THAT_PASS = [
    ("a module-level template",
     "PROMPT = 'Incident {incident} on {service}'\n"
     "def run_agent(q, llm, tools):\n    return llm(PROMPT.format(incident=q, service='db'))"),
    ("a template split across lines",
     "PROMPT = (\n    'Letter:\\n{letter}\\n'\n    'Reply with JSON.'\n)\n"
     "def run_agent(q, llm, tools):\n    return llm(PROMPT.format(letter=q))"),
    ("an annotated template",
     "PROMPT: str = '{q}'\ndef run_agent(q, llm, tools):\n    return llm(PROMPT.format(q=q))"),
]


@pytest.mark.parametrize("what, source", TEMPLATES_THAT_PASS,
                         ids=[case[0] for case in TEMPLATES_THAT_PASS])
def test_a_constant_template_can_be_formatted(what, source):
    outcome = check(source, ALLOWED)
    assert outcome.status == "pass", (what, outcome.reasons)


TEMPLATES_THAT_FAIL = [
    ("a constant whose field reads the script",
     "PROMPT = '{0._script}'\ndef run_agent(q, llm, tools):\n    return PROMPT.format(llm)"),
    ("a template rebound at module level",
     "PROMPT = '{0}'\nPROMPT = '{0._script}'\n"
     "def run_agent(q, llm, tools):\n    return PROMPT.format(llm)"),
    ("a template rebound inside a function",
     "PROMPT = '{0}'\ndef run_agent(q, llm, tools):\n    PROMPT = '{0._scr' + 'ipt}'\n"
     "    return PROMPT.format(llm)"),
    ("a parameter that shadows the template",
     "PROMPT = '{0}'\ndef run_agent(q, llm, tools, PROMPT='{0._script}'):\n"
     "    return PROMPT.format(llm)"),
    ("a template built from two pieces",
     "PROMPT = '{0._scr' + 'ipt}'\ndef run_agent(q, llm, tools):\n    return PROMPT.format(llm)"),
]


@pytest.mark.parametrize("what, source", TEMPLATES_THAT_FAIL,
                         ids=[case[0] for case in TEMPLATES_THAT_FAIL])
def test_a_template_that_is_not_a_constant_is_still_rejected(what, source):
    outcome = check(source, ALLOWED)
    assert outcome.status == "fail", what
    assert any("format" in reason for reason in outcome.reasons), outcome.reasons


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

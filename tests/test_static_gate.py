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

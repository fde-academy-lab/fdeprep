"""Names in code are marked as code in every field a learner reads.

The first beta tester found function names lost in the prose around them. The
workspace renders a backticked span as code, so a name left bare is a name
that reads as an ordinary word. tools/inline_code.py fixes a file in place.
"""

from __future__ import annotations

import pytest
import yaml

from tools.inline_code import (
    MARKDOWN, ROOT, bare_names, check, fix, learner_fields, mark, problem_files,
)


def test_every_name_in_code_is_marked_across_the_catalogue():
    found = [line for path in problem_files() for line in check(path)]
    assert not found, ("run python -m tools.inline_code --fix, then read the diff:\n"
                       + "\n".join(found))


@pytest.mark.parametrize("text, expected", [
    ("Call create_case once", "Call `create_case` once"),
    ("json.loads(text) failed", "`json.loads(text)` failed"),
    ("Start with references(): for each", "Start with `references()`: for each"),
    ("You call tools[name](...) with nothing", "You call `tools[name](...)` with nothing"),
    ("send_text() is in flight", "`send_text()` is in flight"),
    ("the loop died with a KeyError", "the loop died with a `KeyError`"),
    ("read order.order_id first", "read `order.order_id` first"),
])
def test_a_bare_name_is_wrapped_whole(text, expected):
    assert mark(text) == expected


@pytest.mark.parametrize("text", [
    "already `create_case` here",
    "e.g. one item(s) at a time",
    "a code span `that runs\nacross a line` stays whole",
    "a link [docs](https://example.com/a_b) is left alone",
    "Plain English with no names in it.",
])
def test_text_that_is_not_a_bare_name_is_left_alone(text):
    assert mark(text) == text


def test_an_indented_code_block_in_markdown_is_left_alone():
    text = "Implement:\n\n    def run_agent(question: str) -> str\n\nThen call run_agent."
    assert mark(text, markdown=True) == (
        "Implement:\n\n    def run_agent(question: str) -> str\n\nThen call `run_agent`.")


def test_the_fix_changes_only_the_names_and_keeps_the_file_valid(tmp_path, monkeypatch):
    source = (
        "slug: demo\n"
        "title: A demo\n"
        "steps:\n"
        "  - { id: s1, text: Call create_case once, check_id: s1 }\n"
        "diagram:\n"
        "  nodes:\n"
        "    - { id: a, label: approve(), sub: signs the plan }\n"
        "hints:\n"
        "  - A KeyError means the name was never registered.\n"
        "tests:\n"
        "  - { name: t1, spec: { tools: { create_case: { returns: ok } } } }\n"
    )
    monkeypatch.setattr("tools.inline_code.ROOT", tmp_path)
    path = tmp_path / "demo.yaml"
    path.write_text(source)
    changed, left = fix(path)
    after = yaml.safe_load(path.read_text())
    assert (changed, left) == (3, [])
    assert after["steps"][0]["text"] == "Call `create_case` once"
    assert after["diagram"]["nodes"][0]["label"] == "`approve()`"
    assert after["hints"][0] == "A `KeyError` means the name was never registered."
    assert after["tests"][0]["spec"]["tools"] == {"create_case": {"returns": "ok"}}


def test_every_field_the_check_reads_exists_in_some_problem():
    seen = set()
    for path in problem_files():
        for where, _ in learner_fields(yaml.safe_load(path.read_text())):
            seen.add(tuple(k for k in where if not isinstance(k, int)))
    for field in [("title",), ("steps", "text"), ("scenario", "situation"),
                  ("diagram", "nodes", "label"), ("approach", "branches", "leaves"),
                  ("coach", "signals", "say"), ("hints",), ("contract_md",)]:
        assert field in seen, field
    assert MARKDOWN <= {w[0] for w in seen}
    assert ROOT.exists()
    assert bare_names("no names here") == []

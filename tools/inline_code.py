"""Names in code are marked as code in every field a learner reads.

A function, a field or an exception named in plain prose reads as an ordinary
word and gets lost, which is what the first beta tester reported. Every
learner-facing field in a problem file marks them with backticks, and the
workspace renders a backticked span as code.

    python -m tools.inline_code            list every bare name, by file and field
    python -m tools.inline_code --fix      wrap them in backticks, in place

The fix edits only the scalar it changes, keeps the file's formatting, quotes
a value that would otherwise start with a backtick (YAML reserves it), and
re-reads the file to prove nothing else moved. A value it cannot rewrite
safely is left alone and reported, for a person to fix by hand.
"""

from __future__ import annotations

import argparse
import copy
import pathlib
import re
import sys
from typing import Callable, Iterator

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROBLEMS = ROOT / "problems"

# A name is code when it has an underscore, a call, a dot between two lower
# case words, or ends in Error or Exception. English has none of these, so
# the rule can be strict without a list of exceptions to maintain.
SNAKE = r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b"
CALL = r"(?<![\w`])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\[[^\]\s]*\])?\((?!s\))"
DOTTED = r"\b[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+\b"
EXCEPTION = r"\b[A-Z][A-Za-z]*(?:Error|Exception)\b"
NAME = re.compile("|".join(f"(?:{p})" for p in (CALL, DOTTED, SNAKE, EXCEPTION)))
NOT_CODE = {"e.g", "i.e", "etc"}

# Text that is already code, or a link target, is never touched. A code span
# may run across a line break, as it can in Markdown.
PROTECTED = re.compile(r"```.*?```|~~~.*?~~~|`[^`]*`|\]\([^)\s]*\)", re.S)

# The fields written in Markdown, where a line indented four spaces past the
# text around it is a code block (web/components/ui/markdown.tsx, INDENTED).
MARKDOWN = {"brief_md", "contract_md", "reference_md", "hints"}
BLOCK_HEADER = re.compile(r"^[|>][-+0-9]*\s*$")

Path = tuple


def _indented_code(text: str) -> list[tuple[int, int]]:
    """The character ranges of indented code lines, measured from the text's own margin.

    The margin is the least indentation of a non-blank line, so the same rule
    holds for a parsed value, whose margin is 0, and for its raw lines in the
    YAML file, which carry the file's indentation and a block header.
    """
    lines = text.split("\n")
    body = [l for i, l in enumerate(lines)
            if l.strip() and not (i == 0 and BLOCK_HEADER.match(l))]
    if not body:
        return []
    margin = min(len(l) - len(l.lstrip(" ")) for l in body)
    ranges, at = [], 0
    for line in lines:
        rest = line[margin:] if line[:margin].strip() == "" else line
        if line.strip() and (rest.startswith("    ") or rest.startswith("\t")):
            ranges.append((at, at + len(line)))
        at += len(line) + 1
    return ranges


def _spans(text: str, markdown: bool = False) -> Iterator[tuple[int, int]]:
    """Where each bare name starts and ends, a call running to its closing bracket."""
    protected = [(m.start(), m.end()) for m in PROTECTED.finditer(text)]
    if markdown:
        protected += _indented_code(text)

    def inside(i: int) -> bool:
        return any(a <= i < b for a, b in protected)

    for match in NAME.finditer(text):
        start, end = match.span()
        if inside(start) or match.group(0).rstrip(".").lower() in NOT_CODE:
            continue
        if text[end - 1] == "(":
            depth, i = 0, end - 1
            while i < len(text) and text[i] != "\n":
                depth += {"(": 1, ")": -1}.get(text[i], 0)
                if depth == 0:
                    break
                i += 1
            end = i + 1 if i < len(text) and text[i] == ")" else end - 1
        yield start, end


def bare_names(text: str, markdown: bool = False) -> list[str]:
    return [text[a:b] for a, b in _spans(text, markdown)]


def mark(text: str, markdown: bool = False) -> str:
    """The same text with every bare name wrapped in backticks.

    A code span may run across a line break, so one that already exists is
    kept whole: a backtick added inside it would split it in two.
    """
    out, last = [], 0
    for start, end in _spans(text, markdown):
        if start < last:
            continue
        out += [text[last:start], "`", text[start:end], "`"]
        last = end
    marked = "".join(out + [text[last:]])
    kept = [m.group(0) for m in PROTECTED.finditer(text)]
    if any(span not in marked for span in kept):
        raise ValueError("marking would split an existing code span")
    return marked


def learner_fields(problem: dict) -> Iterator[tuple[Path, str]]:
    """Every string a learner reads, with its path in the file.

    Left out on purpose: required headings, which an answer has to reproduce
    word for word; the original prompt a learner edits; and every pattern,
    spec and matcher, which are code already.
    """
    def at(path: Path) -> object:
        node: object = problem
        for key in path:
            if isinstance(node, dict):
                node = node.get(key)
            elif isinstance(node, list) and isinstance(key, int) and key < len(node):
                node = node[key]
            else:
                return None
        return node

    def each(path: Path) -> Iterator[int]:
        node = at(path)
        return iter(range(len(node))) if isinstance(node, list) else iter(())

    paths: list[Path] = [("title",), ("skill",), ("brief_md",), ("contract_md",),
                         ("reference_md",), ("defence_question",),
                         ("interview_evidence", "asked_as"),
                         ("scenario", "who"), ("scenario", "situation"), ("scenario", "stakes"),
                         ("diagram", "title"), ("diagram", "caption"), ("approach", "goal"),
                         ("coach", "opening"), ("coach", "wrap_up"), ("build", "title")]
    paths += [("hints", i) for i in each(("hints",))]
    paths += [("steps", i, "text") for i in each(("steps",))]
    paths += [("tests", i, "annotation_md") for i in each(("tests",))]
    paths += [("prompt_rules", i, "label") for i in each(("prompt_rules",))]
    paths += [("rubric", i, "label") for i in each(("rubric",))]
    for i in each(("scenario", "metrics")):
        paths += [("scenario", "metrics", i, "label"), ("scenario", "metrics", i, "value")]
    for i in each(("diagram", "nodes")):
        paths += [("diagram", "nodes", i, "label"), ("diagram", "nodes", i, "sub")]
    paths += [("diagram", "edges", i, "label") for i in each(("diagram", "edges"))]
    for i in each(("approach", "branches")):
        paths += [("approach", "branches", i, "label"), ("approach", "branches", i, "detail")]
        paths += [("approach", "branches", i, "leaves", j)
                  for j in each(("approach", "branches", i, "leaves"))]
    paths += [("coach", "signals", i, "say") for i in each(("coach", "signals"))]
    for path in paths:
        value = at(path)
        if isinstance(value, str):
            yield path, value


def problem_files() -> list[pathlib.Path]:
    return sorted(p for p in PROBLEMS.rglob("*.yaml") if "_fixtures" not in p.parts)


def check(path: pathlib.Path) -> list[str]:
    problem = yaml.safe_load(path.read_text())
    return [f"{path.relative_to(ROOT)}: {'.'.join(map(str, where))}: {', '.join(names)}"
            for where, text in learner_fields(problem)
            if (names := bare_names(text, where[0] in MARKDOWN))]


# ------------------------------------------------------------------ the fix

def _node_at(root: yaml.Node, path: Path) -> yaml.ScalarNode | None:
    node = root
    for key in path:
        if isinstance(node, yaml.MappingNode):
            node = next((v for k, v in node.value if k.value == key), None)
        elif isinstance(node, yaml.SequenceNode) and isinstance(key, int):
            node = node.value[key] if key < len(node.value) else None
        else:
            return None
        if node is None:
            return None
    return node if isinstance(node, yaml.ScalarNode) else None


def _set(data: dict, path: Path, value: str) -> None:
    node = data
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value


def _quoted(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def fix(path: pathlib.Path) -> tuple[int, list[str]]:
    """Mark every bare name in one file. Returns the fields changed and those left alone."""
    text = path.read_text()
    problem = yaml.safe_load(text)
    root = yaml.compose(text)
    wanted = copy.deepcopy(problem)
    edits: list[tuple[int, int, str]] = []
    skipped: list[str] = []
    for where, value in learner_fields(problem):
        markdown = where[0] in MARKDOWN
        if not bare_names(value, markdown):
            continue
        node = _node_at(root, where)
        if node is None:
            skipped.append(".".join(map(str, where)))
            continue
        start, end = node.start_mark.index, node.end_mark.index
        raw = text[start:end]
        new = mark(value, markdown)
        if node.style in ("|", ">"):
            replacement = mark(raw, markdown)
        elif "\n" in raw:
            # A flow scalar that wraps: its line breaks are YAML folding, not
            # Markdown, so write the marked value back on one line.
            replacement = _quoted(new)
        else:
            replacement = mark(raw, markdown)
            if node.style is None and replacement.startswith("`"):
                replacement = _quoted(new)
        edits.append((start, end, replacement))
        _set(wanted, where, new)

    changed = text
    for start, end, replacement in sorted(edits, reverse=True):
        changed = changed[:start] + replacement + changed[end:]
    if yaml.safe_load(changed) != wanted:
        return 0, [f"{path.relative_to(ROOT)}: the rewrite changed more than the names, "
                   "so nothing was written"]
    if edits:
        path.write_text(changed)
    return len(edits), [f"{path.relative_to(ROOT)}: {s}: fix by hand" for s in skipped]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--fix", action="store_true", help="wrap bare names in backticks")
    args = parser.parse_args(argv)
    report: Callable[[str], None] = print
    if args.fix:
        total, problems = 0, []
        for path in problem_files():
            count, left = fix(path)
            total += count
            problems += left
        for line in problems:
            report(line)
        report(f"marked names in {total} fields")
        return 1 if problems else 0
    found = [line for path in problem_files() for line in check(path)]
    for line in found:
        report(line)
    report(f"{len(found)} fields name code outside backticks")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())

# Inputs this takes, and what each should produce:
#   python -m tools.inline_code            on a clean catalogue: "0 fields name code
#                                          outside backticks", exit 0
#   python -m tools.inline_code            with "Call create_case once" in a step:
#                                          one line naming the file, steps.N.text and
#                                          create_case, exit 1
#   python -m tools.inline_code --fix      on that step: the step reads
#                                          "Call `create_case` once", every other value
#                                          in the file is unchanged, exit 0
#   mark("json.loads(text) failed")        "`json.loads(text)` failed"
#   mark("already `create_case` here")     unchanged
#   mark("e.g. item(s)")                   unchanged

"""The static gate from docs/03 section 4.1. No learner code runs here.

Rejection reasons are named, because "rejected" with no reason teaches nothing
and generates a support message.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field

from runner.problem import ALWAYS_ALLOWED_IMPORTS

MAX_SOURCE_BYTES = 64 * 1024

FORBIDDEN_NAMES = (
    "__import__", "eval", "exec", "open", "compile", "globals", "locals",
    "vars", "getattr", "setattr", "delattr", "input", "breakpoint", "memoryview",
)

FORBIDDEN_MODULES = (
    "subprocess", "socket", "ctypes", "importlib", "os", "sys", "shutil",
    "multiprocessing", "threading", "signal", "resource", "pickle", "marshal",
    "urllib", "http", "requests", "ssl", "asyncio", "pty", "code", "builtins",
)

FORBIDDEN_ATTRS = ("system", "popen", "spawn", "fork", "__subclasses__", "__globals__")

# docs/03 section 9.1 says learner code can read anything staged into its own
# process, and the harness objects are staged into it. Assertions are not, so
# expected values stay out either way, but two other things were one attribute
# access away.
#
# `llm._script` is the whole scripted model, which turns a problem into a
# lookup. `llm._trace` and `tools._trace` are the trace, and every count the
# evaluator reports is recomputed from the steps in it, so appending to it
# fabricates tool calls that never happened. getattr was already blocked;
# `obj._name` was not.
#
# The rule is the blunt one on purpose: a leading underscore means the author
# of that object said it was not part of the interface, and a static gate
# cannot tell whose object it is holding. It also subsumes every dunder, which
# is why __class__ and __mro__ need no entry of their own.
PRIVATE_BASES = ("self", "cls")

# namedtuple's public interface carries underscores so that the names cannot
# collide with a field. Rejecting `_asdict()` would fail correct code for a
# reason the learner could do nothing about.
NAMEDTUPLE_API = ("_asdict", "_replace", "_fields", "_field_defaults", "_make")


@dataclass
class StaticResult:
    status: str
    reasons: list[str] = field(default_factory=list)


def check(source: str, allowed_imports) -> StaticResult:
    reasons: list[str] = []

    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        return StaticResult("fail", [
            f"the solution is longer than 64KB, which no problem needs"
        ])

    try:
        tree = ast.parse(source, filename="solution.py")
    except SyntaxError as exc:
        return StaticResult("fail", [
            f"syntax error on line {exc.lineno}: {exc.msg}"
        ])

    allowed = set(ALWAYS_ALLOWED_IMPORTS) | {str(m) for m in (allowed_imports or ())}

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                reasons += _check_module(alias.name, allowed, node.lineno)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                reasons.append(
                    f"line {node.lineno}: a relative import cannot resolve inside the sandbox"
                )
            elif node.module:
                reasons += _check_module(node.module, allowed, node.lineno)
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            reasons.append(f"line {node.lineno}: {node.id} is not available in the sandbox")
        elif isinstance(node, ast.Attribute):
            reasons += _check_attribute(node)

    if not _defines_run_agent(tree):
        reasons.append("the solution defines no run_agent function at module level")

    seen, unique = set(), []
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            unique.append(reason)

    return StaticResult("fail" if unique else "pass", unique)


def _check_attribute(node: ast.Attribute) -> list[str]:
    """One attribute access, checked for a private name and then for a name on
    the fixed list."""
    if node.attr.startswith("_") and not _private_is_the_learners_own(node):
        return [
            f"line {node.lineno}: {node.attr} is a private attribute of another object, "
            "and the sandbox does not allow reading one. Everything this problem gives you "
            "is reachable without it: call llm(prompt) and the callables in tools"
        ]
    if node.attr in FORBIDDEN_ATTRS:
        return [f"line {node.lineno}: the {node.attr} attribute is not reachable"]
    return []


def _private_is_the_learners_own(node: ast.Attribute) -> bool:
    """True when the private name belongs to the learner rather than to
    something the harness handed them."""
    if node.attr in NAMEDTUPLE_API:
        return True
    base = node.value
    if isinstance(base, ast.Name) and base.id in PRIVATE_BASES:
        return True
    # super().__init__() in a learner's own class hierarchy.
    return (
        isinstance(base, ast.Call)
        and isinstance(base.func, ast.Name)
        and base.func.id == "super"
    )


def _check_module(name: str, allowed: set[str], lineno: int) -> list[str]:
    top = name.split(".")[0]
    if top in FORBIDDEN_MODULES:
        return [f"line {lineno}: {top} is not importable in the sandbox"]
    if top not in allowed:
        return [
            f"line {lineno}: {top} is not in this problem's allowed imports "
            f"({', '.join(sorted(allowed))})"
        ]
    return []


def _defines_run_agent(tree: ast.Module) -> bool:
    return any(
        isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "run_agent"
        for node in tree.body
    )

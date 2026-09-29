"""The static gate from docs/03 section 4.1. No learner code runs here.

Rejection reasons are named, because "rejected" with no reason teaches nothing
and generates a support message.
"""

from __future__ import annotations

import ast
import string
from dataclasses import dataclass, field

from runner.problem import ALWAYS_ALLOWED_IMPORTS

MAX_SOURCE_BYTES = 64 * 1024

FORBIDDEN_NAMES = (
    "__import__", "eval", "exec", "open", "compile", "globals", "locals",
    "vars", "getattr", "setattr", "delattr", "input", "breakpoint", "memoryview",
    # The builtins module itself, which every name above is an attribute of.
    "__builtins__",
)

FORBIDDEN_MODULES = (
    "subprocess", "socket", "ctypes", "importlib", "os", "sys", "shutil",
    "multiprocessing", "threading", "signal", "resource", "pickle", "marshal",
    "urllib", "http", "requests", "ssl", "asyncio", "pty", "code", "builtins",
    # Both hand back an object's private state without an attribute access
    # the rule below could see: gc.get_referents(llm) returns its __dict__.
    # Closed whatever a problem's allowed_imports says.
    "gc", "inspect",
)

FORBIDDEN_ATTRS = ("system", "popen", "spawn", "fork", "__subclasses__", "__globals__")

# The modules a solution may import hold public references to the
# interpreter's own: typing.contextlib.os, json.codecs.sys, re.enum.bltns,
# dataclasses.inspect. None of those names starts with an underscore, so the
# private rule below never saw them. These are the last-hop names of every
# such route, found by walking every module a solution may import;
# tests/test_static_gate.py repeats the walk, so a Python upgrade or a newly
# allowed module cannot add a route nobody named.
#
# This list names a route so that an honest learner reads a reason. It is not
# the boundary. The scripted model and the trace are not in the sandbox's
# process at all, and the sandbox starts with no credentials in reach
# (runner/battery/host.py), so a route this list misses reaches nothing.
MODULE_ROUTE_ATTRS = ("sys", "os", "builtins", "bltns", "importlib", "inspect", "io")

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

# Names with underscores that read a plain string and lead nowhere. A content
# author found that type(exc).__name__, the usual way to name an exception's
# type, failed the private rule; a contract that asks for the type set a trap
# the learner could not avoid.
PUBLIC_DUNDERS = ("__name__", "__qualname__")

# namedtuple's public interface carries underscores so that the names cannot
# collide with a field. Rejecting `_asdict()` would fail correct code for a
# reason the learner could do nothing about.
NAMEDTUPLE_API = ("_asdict", "_replace", "_fields", "_field_defaults", "_make")

# str.format resolves "{0._script}" with a real getattr at run time, so a
# format string is an attribute access the walk never sees as one. A format
# string written as a literal is checked field by field; one built at run time
# cannot be, and an f-string does everything a learner needs, so it wins.
FORMAT_ATTRS = ("format", "format_map")


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
        elif isinstance(node, ast.MatchClass):
            # case object(_script=s) binds s to obj._script by keyword.
            for name in node.kwd_attrs:
                if name.startswith("_"):
                    reasons.append(
                        f"line {node.lineno}: a class pattern that binds {name} reads a private "
                        "attribute of another object, which the sandbox does not allow"
                    )

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
    if (node.attr.startswith("_") and node.attr not in PUBLIC_DUNDERS
            and not _private_is_the_learners_own(node)):
        return [
            f"line {node.lineno}: {node.attr} is a private attribute of another object, "
            "and the sandbox does not allow reading one. Everything this problem gives you "
            "is reachable without it: call llm(prompt) and the callables in tools"
        ]
    if node.attr in FORMAT_ATTRS:
        return _check_format(node)
    if node.attr in FORBIDDEN_ATTRS:
        return [f"line {node.lineno}: the {node.attr} attribute is not reachable"]
    if node.attr in MODULE_ROUTE_ATTRS and not _on_the_learners_own_object(node):
        return [
            f"line {node.lineno}: .{node.attr} reaches one of the interpreter's own modules "
            "through another module, which the sandbox does not allow. Import what you need "
            "from this problem's allowed imports instead"
        ]
    return []


def _check_format(node: ast.Attribute) -> list[str]:
    """str.format and format_map, which read attributes named inside a string."""
    if node.attr == "format_map":
        return [
            f"line {node.lineno}: format_map looks up attributes at run time, which the "
            "sandbox does not allow. Use an f-string"
        ]
    base = node.value
    if not (isinstance(base, ast.Constant) and isinstance(base.value, str)):
        return [
            f"line {node.lineno}: str.format on a string built at run time can read attributes "
            "the sandbox keeps private. Use an f-string"
        ]
    field_name = _traversing_field(base.value)
    if field_name:
        return [
            f"line {node.lineno}: the format field {{{field_name}}} reads an attribute or an "
            "item through str.format, which the sandbox does not allow. Use an f-string"
        ]
    return []


def _traversing_field(text: str, depth: int = 0) -> str | None:
    """The first replacement field that walks into an object, if any.

    A field such as {0.name} or {0[key]} makes str.format call getattr or
    __getitem__. Nested fields inside a format spec are read too. A string the
    parser rejects is left alone, because str.format rejects it the same way
    at run time and reads nothing.
    """
    try:
        for _literal, field_name, spec, _conversion in string.Formatter().parse(text):
            if field_name and ("." in field_name or "[" in field_name):
                return field_name
            if spec and depth < 2:
                inner = _traversing_field(spec, depth + 1)
                if inner:
                    return inner
    except ValueError:
        return None
    return None


def _on_the_learners_own_object(node: ast.Attribute) -> bool:
    """self.io is the learner's attribute, whatever it happens to be called."""
    return isinstance(node.value, ast.Name) and node.value.id in PRIVATE_BASES


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
    if top == "__future__":
        # A compiler directive. `from __future__ import annotations` is how a
        # lot of people start every file.
        return []
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

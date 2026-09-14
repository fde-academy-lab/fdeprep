"""The matcher vocabulary from docs/03 section 2.2.

Rules are evaluated in order and the first match wins. Nothing here reads the
clock or a random source, so a prompt always selects the same reply.
"""

from __future__ import annotations

import re
from typing import Any


class ScriptError(RuntimeError):
    """The script cannot answer this prompt. An authoring error, never a learner error."""


def matches(rule: Any, prompt: str, call_index: int) -> bool:
    if rule == "*":
        return True
    if not isinstance(rule, dict):
        raise ScriptError(f"unknown match form {rule!r}")
    if len(rule) != 1:
        raise ScriptError(f"a match takes exactly one form, got {sorted(rule)}")

    (kind, value), = rule.items()
    if kind == "contains":
        return str(value) in prompt
    if kind == "regex":
        return re.search(str(value), prompt) is not None
    if kind == "call_index":
        return call_index == int(value)
    if kind == "all":
        return all(matches(nested, prompt, call_index) for nested in value)
    raise ScriptError(f"unknown matcher {kind!r}")


def select(script: list[dict[str, Any]], prompt: str, call_index: int) -> str:
    for entry in script:
        if matches(entry.get("match"), prompt, call_index):
            return str(entry.get("reply", ""))
    raise ScriptError(
        f"no rule matched model call {call_index} and the script has no \"*\" fallback"
    )

"""Reference solution for check-trace-invariants-across-valid-paths.

The checker never looks at the recorded path. It walks the steps once and
tests three rules that hold on every valid run in any order: every call gets
a result, nothing with a side effect happens after a refusal, and each
required pair comes in its required order. Each break is reported against the
call that caused it, because that is the step a reviewer opens first.

A record with no steps is not a clean run. Every rule is true of an empty
list, so the checker says there was nothing to check instead of passing it.

The model writes the reviewer's line from the findings alone. The record's own
text never reaches the prompt, because it was written by something else.
"""

import json
import re


def violations(steps: list, actions: set, requires: list) -> dict:
    found = {}
    waiting = {}
    called = set()
    refused = False

    for step in steps:
        if not isinstance(step, dict):
            continue
        kind = step.get("type")
        if kind == "refusal":
            refused = True
        elif kind == "tool_result":
            waiting.pop(step.get("call_id"), None)
        elif kind == "tool_call":
            tool, number = step.get("tool"), step.get("n")
            if refused and tool in actions:
                found.setdefault("action_after_refusal", []).append(number)
            if any(tool == then and first not in called for first, then in requires):
                found.setdefault("out_of_order", []).append(number)
            called.add(tool)
            waiting[step.get("id")] = number

    if waiting:
        found["unanswered_call"] = list(waiting.values())
    return found


def run_agent(question: str, llm, tools: dict) -> str:
    record = tools["trace"](run=question)
    steps = record.get("steps") if isinstance(record, dict) else None

    if isinstance(steps, list) and steps:
        actions = set(record.get("actions") or [])
        requires = [tuple(pair) for pair in record.get("requires") or [] if len(pair) == 2]
        found = violations(steps, actions, requires)
        verdict = "fail" if found else "pass"
    else:
        found, verdict = {}, "no_trace"

    findings = json.dumps({"verdict": verdict, "violations": found})
    note = llm(f"Violations: {findings}\nWrite one line for the reviewer.")
    return json.dumps({"verdict": verdict, "violations": found, "note": note.strip()})

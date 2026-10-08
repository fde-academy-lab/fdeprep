"""Reference solution for turn-failed-traces-into-eval-cases.

An eval case built from a failure has to keep one fact the customer's data
carries: which values were the same value. The agent that looked up the wrong
number failed precisely because two numbers differed, so every number gets a
placeholder of its own, and the same number gets the same placeholder however
it was written. An email is the same address in any case, and a phone number
is the same number by its last ten digits.

The placeholders are numbered afresh for every trace, and the map is thrown
away when the trace is done. Inside a case they keep the failure readable;
across cases they link nothing, and nothing anywhere leads back to a person.

The data turns up wherever the services put it, so the walk goes through every
nested value, and a phone number stored as a whole number is still a phone
number.

The case ends at the failed step, because everything after it is the future:
the agent's own recovery, the customer's correction and the reviewer's note.
Two checks then decide whether the case is worth keeping. If the failed step
and the expected step are the same, the case tests nothing. If the expected
step uses a value the context never showed, it asks the agent for something
it could not have known.
"""

import json
import re

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\d)(?:\+91[ -]?|0)?[6-9](?:[ -]?\d){9}(?!\d)")
PLACEHOLDER = re.compile(r"<(?:EMAIL|PHONE)_\d+>")
REASONS = ("unreviewed", "infrastructure", "no_difference", "unanswerable")


class Pseudonyms:
    """One set of placeholders for one trace."""

    def __init__(self):
        self.tables = {"EMAIL": {}, "PHONE": {}}

    def name(self, kind: str, key: str) -> str:
        table = self.tables[kind]
        if key not in table:
            table[key] = f"<{kind}_{len(table) + 1}>"
        return table[key]

    def phone(self, written: str) -> str:
        return self.name("PHONE", re.sub(r"\D", "", written)[-10:])

    def text(self, value: str) -> str:
        value = EMAIL.sub(lambda m: self.name("EMAIL", m.group(0).lower()), value)
        return PHONE.sub(lambda m: self.phone(m.group(0)), value)

    def walk(self, value):
        if isinstance(value, dict):
            return {key: self.walk(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.walk(item) for item in value]
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, int) and not isinstance(value, bool):
            if PHONE.fullmatch(str(value)):
                return self.phone(str(value))
        return value


def run_agent(question: str, llm, tools: dict) -> str:
    data = tools["failed_traces"](day=question) or {}
    cases, left_out = [], dict.fromkeys(REASONS, 0)

    for trace in data.get("traces") or []:
        review = trace.get("review")
        if not isinstance(review, dict):
            left_out["unreviewed"] += 1
            continue
        if review.get("kind") == "infrastructure":
            left_out["infrastructure"] += 1
            continue
        steps = trace.get("steps") or []
        position = next((i for i, step in enumerate(steps)
                         if step.get("n") == review.get("step")), None)
        if not isinstance(review.get("correct"), dict) or position is None:
            left_out["unreviewed"] += 1
            continue

        names = Pseudonyms()
        context = names.walk(steps[:position])
        failed = names.walk(steps[position])
        expected = names.walk(review["correct"])

        if {key: value for key, value in failed.items() if key != "n"} == expected:
            left_out["no_difference"] += 1
            continue
        shown = json.dumps(context)
        if any(p not in shown for p in PLACEHOLDER.findall(json.dumps(expected))):
            left_out["unanswerable"] += 1
            continue

        cases.append({"id": trace.get("trace"), "context": context,
                      "failed_step": failed, "expected_step": expected})

    return json.dumps({"cases": cases, "left_out": left_out})

"""Reference solution for normalise-answers-without-accepting-leaks.

Both sides go through the same five rules, and then the grader asks whether
the two strings are equal. The rules are a closed list, so the grader forgives
exactly what the eval team wrote down. Anything else in a reply, a list of
options or a pasted transcript, stays in the string and fails the comparison.

The model is sent the question and nothing else, so it cannot copy the key.
"""

import json
import re

_SPACE = re.compile(r"\s+")
_LABEL = re.compile(r"^answer:\s*")


def normalise(text: str) -> str:
    text = str(text).lower()
    text = text.replace("**", "").replace('"', "")
    text = _SPACE.sub(" ", text).strip()
    text = _LABEL.sub("", text, count=1)
    if text.endswith("."):
        text = text[:-1]
    return text


def run_agent(question: str, llm, tools: dict) -> str:
    case = tools["case"](id=question) or {}
    reply = llm(case.get("question", ""))

    got = normalise(reply)
    want = normalise(case.get("expected", ""))
    return json.dumps({"verdict": "pass" if got == want else "fail", "normalised": got})

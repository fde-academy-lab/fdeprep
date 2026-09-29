"""What an unprepared learner writes in four minutes.

It lower-cases both sides and asks whether the expected answer appears
anywhere inside the reply. That forgives every formatting difference at once,
and it also forgives a reply that names every option and a reply that pasted a
tool transcript, because the right answer sits inside both of them.
"""

import json
import re


def normalise(text: str) -> str:
    return text.lower().strip()


def run_agent(question: str, llm, tools: dict) -> str:
    case = tools["case"](id=question) or {}
    reply = llm(case.get("question", ""))

    expected = normalise(case.get("expected", ""))
    got = normalise(reply)
    verdict = "pass" if expected in got else "fail"
    return json.dumps({"verdict": verdict, "normalised": got})

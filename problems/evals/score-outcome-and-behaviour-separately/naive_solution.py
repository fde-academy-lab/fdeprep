"""What an unprepared learner writes in four minutes.

It asks the model for one judgement and reports it as both verdicts, reading
the run's own summary line to decide whether anything was called. The summary
was written by the thing being evaluated, so a run that says no tools were
called is recorded as having called none.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Case: {question}\n"
    summary = ""

    for _ in range(8):
        output = llm(scratchpad)

        if "Judgement:" in output:
            verdict = "pass" if "pass" in output.split("Judgement:", 1)[1].lower() else "fail"
            looks_clean = "no tools" in summary.lower() or "lookup" in summary.lower()
            return json.dumps({
                "outcome": verdict,
                "behaviour": "pass" if looks_clean else verdict,
                "reasons": [],
            })

        action = re.search(r"Action:\s*(\w+)\(", output, re.MULTILINE)
        if action is None:
            continue

        record = tools[action.group(1)]() or {}
        summary = record.get("summary", "")

        scratchpad += (
            f"{output}\nExpected: {record.get('expected', '')}\n"
            f"Answer: {record.get('answer', '')}\n"
            f"Summary: {summary}\n"
        )

    return json.dumps({"outcome": "fail", "behaviour": "fail", "reasons": []})

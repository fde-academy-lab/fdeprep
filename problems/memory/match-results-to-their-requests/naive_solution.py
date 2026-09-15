"""What an unprepared learner writes in four minutes.

It zips the ids it asked for against the results it got back. That works
whenever the carriers happen to reply in the order they were asked, which is
most of the time, which is why this reached production.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\((.*?)\)\s*$", output, re.MULTILINE)
        if action is None:
            continue

        raw = action.group(2).split("=", 1)[-1]
        asked = [part.strip() for part in raw.split(",") if part.strip()]

        result = tools[action.group(1)](ids=raw.strip())
        results = (result or {}).get("results") or []

        lines = "\n".join(
            f"{ref}={entry.get('state')}" for ref, entry in zip(asked, results)
        )
        scratchpad += f"{output}\n<statuses>\n{lines}\n</statuses>\n"

    return "I could not check those orders."

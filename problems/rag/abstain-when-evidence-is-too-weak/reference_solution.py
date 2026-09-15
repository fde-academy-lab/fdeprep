"""Reference solution for abstain-when-evidence-is-too-weak.

Chunks are filtered before anything is written into the scratchpad, so a
below-threshold sentence never reaches the model. Filtering the answer
afterwards would be too late: the model has already read the text and a
plausible sentence in the prompt is a sentence in the answer.

When nothing survives the filter the loop returns the abstention itself
rather than asking the model to write one, which spends a call to obtain a
sentence that is already in the file.
"""

import json
import re

THRESHOLD = 0.55
NOTHING_FOUND = "I could not find anything in the help centre that answers this."

_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            return answer or NOTHING_FOUND

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        result = tools[action.group(1)](query=action.group(2).split("=", 1)[-1].strip())
        chunks = (result or {}).get("chunks") or []
        usable = [c for c in chunks if float(c.get("score", 0)) >= THRESHOLD]

        if not usable:
            return NOTHING_FOUND

        scratchpad += f"{output}\n<evidence>{json.dumps(usable)}</evidence>\n"

    return NOTHING_FOUND

"""What an unprepared learner writes in four minutes.

Every block starts with its chunk id, so the citations are right whenever the
evidence fits. The budget is applied by slicing the joined text to 400
characters, which cuts whichever block straddles the limit in the middle of
its sentence. The half sentence keeps its real id, and the model finishes it.
"""

import json
import re

MAX_EVIDENCE = 400
FALLBACK = "I could not answer that from the handbook."


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*search\(query=(.*?)\)\s*$", output, re.MULTILINE)
        if action is None:
            continue

        result = tools["search"](query=action.group(1).strip())
        blocks = [f"[{c['id']}] {c['text']}" for c in result.get("chunks", [])]
        scratchpad += f"{output}\n" + "\n".join(blocks)[:MAX_EVIDENCE] + "\n"

    return FALLBACK

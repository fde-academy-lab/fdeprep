"""What an unprepared learner writes in four minutes.

It cuts the article into windows of 120 that tile it end to end. No gaps, no
waste, and one sentence in six cut in half. The half that survives reads like
the start of an answer, and a model handed the start of an answer finishes it.
"""

import json
import re

SIZE = 120


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"
    wanted = {word.lower() for word in re.findall(r"[A-Za-z]{4,}", question)}

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\((.*?)\)\s*$", output, re.MULTILINE)
        if action is None:
            continue

        result = tools[action.group(1)](id=action.group(2).split("=", 1)[-1].strip())
        text = (result or {}).get("text", "")

        kept = []
        for start in range(0, len(text), SIZE):
            chunk = text[start:start + SIZE]
            if wanted & {w.lower() for w in re.findall(r"[A-Za-z]{4,}", chunk)}:
                kept.append(f"[start={start}] {chunk}")

        if not kept:
            return "I could not find that in the help centre."

        scratchpad += f"{output}\n<evidence>\n" + "\n".join(kept) + "\n</evidence>\n"

    return "I could not find that in the help centre."

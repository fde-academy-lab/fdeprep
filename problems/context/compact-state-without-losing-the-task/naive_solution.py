"""What an unprepared learner writes in four minutes.

It keeps the most recent turns and counts the rest. Recency is the obvious
key and it throws away exactly the turns a conversation is held to, because a
requirement is stated when the customer first explains their situation, which
is the oldest thing in the thread.
"""

import json
import re

KEEP_LAST = 4


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\(", output, re.MULTILINE)
        if action is None:
            continue

        result = tools[action.group(1)]()
        turns = (result or {}).get("turns") or []

        recent = turns[-KEEP_LAST:]
        dropped = len(turns) - len(recent)
        lines = [f"[{t.get('n')}] {t.get('text', '')}" for t in recent]
        if dropped:
            lines.insert(0, f"({dropped} earlier turns dropped in compaction)")

        scratchpad += f"{output}\n<history>\n" + "\n".join(lines) + "\n</history>\n"

    return "I could not rebook this."

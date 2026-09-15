"""Reference solution for compact-state-without-losing-the-task.

The filter is keyed on kind rather than on age. Requirements, approvals and
open questions survive verbatim wherever they sit in the conversation, and the
chat turns collapse into one line saying how many went.

That line is doing real work. A model reading a history with an unmarked gap
fills the gap; a model reading "6 chat turns dropped" knows it is holding a
summary.
"""

import json
import re

KEEP = ("requirement", "approval", "open_question")
_ACTION = re.compile(r"Action:\s*(\w+)\(", re.MULTILINE)


def _compact(turns: list) -> str:
    lines = []
    dropped = 0
    for turn in turns:
        if turn.get("kind") in KEEP:
            lines.append(f"[{turn.get('n')}] {turn.get('kind')}: {turn.get('text', '')}")
        else:
            dropped += 1
    if dropped:
        lines.append(f"({dropped} chat turns dropped in compaction)")
    return "\n".join(lines)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            if answer:
                return answer
            scratchpad += f"{output}\nThat answer was empty.\n"
            continue

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        result = tools[action.group(1)]()
        turns = (result or {}).get("turns") or []
        scratchpad += f"{output}\n<history>\n{_compact(turns)}\n</history>\n"

    return "I could not rebook this."

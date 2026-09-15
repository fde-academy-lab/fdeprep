"""Reference solution for keep-the-answer-across-a-chunk-boundary.

Windows are 120 characters and start every 80, so any sentence shorter than
the 40 character overlap is whole in at least one of them. Tiling the article
with no overlap costs less storage and cuts one sentence in six in half, which
is the sentence the question is usually about.

Each window keeps the offset it had in the article. A window's index in the
filtered list is not its position in the text, and a citation pointing at the
list points at nothing a person can check.
"""

import json
import re

SIZE = 120
OVERLAP = 40
STEP = SIZE - OVERLAP

_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)


def _windows(text: str):
    if not text:
        return []
    out = []
    for start in range(0, max(1, len(text)), STEP):
        chunk = text[start:start + SIZE]
        if chunk:
            out.append((start, chunk))
        if start + SIZE >= len(text):
            break
    return out


def _terms(question: str):
    return {word.lower() for word in re.findall(r"[A-Za-z]{4,}", question)}


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"
    wanted = _terms(question)

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

        result = tools[action.group(1)](id=action.group(2).split("=", 1)[-1].strip())
        text = (result or {}).get("text", "")

        kept = [
            f"[start={start}] {chunk}"
            for start, chunk in _windows(text)
            if wanted & {w.lower() for w in re.findall(r"[A-Za-z]{4,}", chunk)}
        ]
        if not kept:
            return "I could not find that in the help centre."

        scratchpad += f"{output}\n<evidence>\n" + "\n".join(kept) + "\n</evidence>\n"

    return "I could not find that in the help centre."

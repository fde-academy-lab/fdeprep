"""Reference solution for attach-a-source-to-each-evidence-block.

Every block starts with the chunk's own id, because the id is the citation a
person can open. The source name is not one: most chunks come from the same
handbook, and "Staff handbook" points at the whole of it.

The budget is spent in whole blocks. The first block that would take the
evidence past 400 characters ends it. Cutting that block instead would send a
sentence without its ending under a real citation, and the model would finish
the sentence itself.
"""

import json
import re

MAX_EVIDENCE = 400
FALLBACK = "I could not answer that from the handbook."

_ACTION = re.compile(r"Action:\s*search\((?:query=)?(.*?)\)\s*$", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            return answer or FALLBACK

        action = _ACTION.search(output)
        if action is None or "search" not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        result = tools["search"](query=action.group(1).strip()) or {}
        text = evidence(result.get("chunks") or [])
        if not text:
            return FALLBACK
        scratchpad += f"{output}\n<evidence>\n{text}\n</evidence>\n"

    return FALLBACK


def block(chunk: dict) -> str:
    """One evidence block: the chunk's own id in square brackets, then its text."""
    return f"[{chunk.get('id', '')}] {chunk.get('text', '')}"


def evidence(chunks: list) -> str:
    """Whole blocks, best first, until the next one would pass MAX_EVIDENCE."""
    kept, used = [], 0
    for chunk in chunks:
        line = block(chunk)
        if used + len(line) > MAX_EVIDENCE:
            break
        kept.append(line)
        used += len(line)
    return "\n".join(kept)

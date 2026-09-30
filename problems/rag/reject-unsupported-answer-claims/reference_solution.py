"""Reference solution for reject-unsupported-answer-claims.

Every sentence of the draft is checked against the chunks it cites before any
of it is returned. An id that exists proves the chunk exists and nothing more,
so the check reads the chunk: every number in the sentence has to be among the
numbers of the chunks it cites.

Numbers are compared whole, so 3 is not found inside 30. The ids are taken out
of the sentence first, or m-4 would read as a claim about the number 4. A
sentence that cites two chunks may take its numbers from either.

Unsupported sentences are dropped. When none is left the loop returns the
fixed sentence itself rather than asking the model for another draft.
"""

import json
import re

CANNOT_CHECK = "I could not check that answer against the mortgage terms."

_ACTION = re.compile(r"Action:\s*search\((?:query=)?(.*?)\)\s*$", re.MULTILINE)
_CITATION = re.compile(r"\[([^\]]+)\]")
_SENTENCE_END = re.compile(r"(?<=\.)\s+")


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"
    retrieved = {}

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            draft = output.split("Final Answer:", 1)[1].strip()
            kept = [s for s in _SENTENCE_END.split(draft) if supported(s, retrieved)]
            return " ".join(kept) or CANNOT_CHECK

        action = _ACTION.search(output)
        if action is None or "search" not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        result = tools["search"](query=action.group(1).strip()) or {}
        chunks = result.get("chunks") or []
        for chunk in chunks:
            retrieved[chunk.get("id", "")] = chunk.get("text", "")
        blocks = "\n".join(f"[{c.get('id', '')}] {c.get('text', '')}" for c in chunks)
        scratchpad += f"{output}\n<evidence>\n{blocks}\n</evidence>\n"

    return CANNOT_CHECK


def numbers(text: str) -> set:
    """Every number in the text, such as 10, 1,499 or 4.5."""
    return set(re.findall(r"\d+(?:[.,]\d+)*", text))


def supported(sentence: str, retrieved: dict) -> bool:
    """True when the sentence cites retrieved chunks and every number in it
    appears among the numbers of the chunks it cites."""
    cited = [found.strip() for found in _CITATION.findall(sentence)]
    if not cited or any(chunk_id not in retrieved for chunk_id in cited):
        return False
    claimed = numbers(_CITATION.sub(" ", sentence))
    available = set()
    for chunk_id in cited:
        available |= numbers(retrieved[chunk_id])
    return claimed <= available

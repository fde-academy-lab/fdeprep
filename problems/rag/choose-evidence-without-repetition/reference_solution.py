"""Reference solution for choose-evidence-without-repetition.

Search scores each chunk on its own, so five copies of one paragraph all score
well and arrive together at the top. Copies are skipped before a place is
filled: skipping them afterwards leaves one block where there were five, and
the chunk that answers the question is still outside.

Each candidate is compared with every block already kept, because copies are
rarely neighbours in a ranking and a check against the last block alone lets a
copy back in whenever something else ranked between them.

A copy is decided by wording. Where a chunk came from says nothing: the copies
come from five different pages, and one page holds several different facts.
"""

import json
import re

MAX_BLOCKS = 5
NEAR_DUPLICATE = 0.8
NOT_FOUND = "I could not find that in the policy wording."

_ACTION = re.compile(r"Action:\s*search\((?:query=)?(.*?)\)\s*$", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip() or NOT_FOUND

        action = _ACTION.search(output)
        if action is None or "search" not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        result = tools["search"](query=action.group(1).strip()) or {}
        chosen = choose(result.get("chunks") or [])
        if not chosen:
            return NOT_FOUND
        blocks = "\n".join(f"[{c.get('id', '')}] {c.get('text', '')}" for c in chosen)
        scratchpad += f"{output}\n<evidence>\n{blocks}\n</evidence>\n"

    return NOT_FOUND


def words(text: str) -> set:
    """Lowercased runs of letters and digits."""
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def overlap(a: str, b: str) -> float:
    """Shared words over all the words either text uses, from 0 to 1."""
    left, right = words(a), words(b)
    everything = left | right
    return len(left & right) / len(everything) if everything else 1.0


def choose(chunks: list) -> list:
    """At most MAX_BLOCKS chunks, best first, with no near-duplicates."""
    kept = []
    for chunk in chunks:
        text = chunk.get("text", "")
        if any(overlap(text, k.get("text", "")) >= NEAR_DUPLICATE for k in kept):
            continue
        kept.append(chunk)
        if len(kept) == MAX_BLOCKS:
            break
    return kept

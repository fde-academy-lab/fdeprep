"""Reference solution for fuse-lexical-and-semantic-rankings.

Keyword and vector scores are on different scales, so the two lists are fused
by position. Each chunk earns 1 / (60 + rank) from every list it appears in,
and a chunk both searches rank fourth beats one that a single search ranks
first. Agreement between two retrievers that fail differently is the evidence
hybrid search exists to find.

Three details keep it honest at the edges. An id counts once per list, at its
first position, so a duplicated embedding is not a second vote. An id missing
from a list earns nothing from it. Ties go to the smaller id, so the same two
lists always produce the same prompt.

A retriever that raises, or answers with anything other than a list of
results, is an empty list, and the other list still answers.
"""

import json
import re

K = 60
TOP = 3
NOT_FOUND = "I could not find that in the knowledge base."

_ACTION = re.compile(r"Action:\s*search\((?:query=)?(.*?)\)\s*$", re.MULTILINE)


def ranks(results: list) -> dict:
    """Map each id to its position in results, counting from 1. An id that
    appears again later keeps its first position."""
    positions = {}
    for position, item in enumerate(results, 1):
        positions.setdefault(item["id"], position)
    return positions


def fuse(lexical: list, semantic: list) -> list:
    """Every result from either list, highest fused score first. An id earns
    one over (K plus its rank) from each list it is in, and a tie goes to
    the smaller id."""
    scores, first_seen = {}, {}
    for results in (lexical, semantic):
        for chunk_id, rank in ranks(results).items():
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1 / (K + rank)
        for item in results:
            first_seen.setdefault(item["id"], item)
    order = sorted(scores, key=lambda chunk_id: (-scores[chunk_id], chunk_id))
    return [first_seen[chunk_id] for chunk_id in order]


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip() or NOT_FOUND

        action = _ACTION.search(output)
        if action is None:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        query = action.group(1).strip()
        fused = fuse(_results(tools, "keyword_search", query),
                     _results(tools, "vector_search", query))[:TOP]
        if not fused:
            return NOT_FOUND

        blocks = "\n".join(f"[{c['id']}] {c.get('text', '')}" for c in fused)
        scratchpad += f"{output}\n<evidence>\n{blocks}\n</evidence>\n"

    return NOT_FOUND


def _results(tools: dict, name: str, query: str) -> list:
    """One retriever's results, or an empty list when it fails."""
    try:
        reply = tools[name](query=query)
    except Exception:
        return []
    results = reply.get("results") if isinstance(reply, dict) else None
    if not isinstance(results, list):
        return []
    return [item for item in results if isinstance(item, dict) and "id" in item]

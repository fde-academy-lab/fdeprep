"""Reference solution for rerank-enough-candidates-to-find-the-answer.

A reranker reorders the passages it reads and cannot promote one it never
read, so how deep it reads decides recall. The desk's own review put the
answer inside the first 24 unique candidates for 96 questions in 100, and
three calls of eight reach exactly that far.

Repeated ids are dropped before the first call, because a slot spent on a
second copy pushes a unique passage past the 24th place. The reranker scores
each passage against the query on its own, so scores from separate calls
compare and merge into one dict by id.

Any reranker error leaves the fused order, which is worse than a reranked one
and still an ordering. The whole list falls back, never half of it, and
`reranked` says which order answered, so a trace or an evaluation can tell.
"""

import json

DEPTH = 24
BATCH = 8
TOP = 3


def unique(candidates: list) -> list:
    """The candidates in fused order, each id once, at its first position."""
    seen, kept = set(), []
    for candidate in candidates:
        if candidate["id"] not in seen:
            seen.add(candidate["id"])
            kept.append(candidate)
    return kept


def rerank_scores(query: str, candidates: list, tools: dict):
    """Reranker scores by id for the first DEPTH candidates, BATCH ids a call,
    or None when any call returns an error."""
    ids = [c["id"] for c in candidates[:DEPTH]]
    scores = {}
    for start in range(0, len(ids), BATCH):
        reply = tools["rerank"](query=query, ids=ids[start:start + BATCH])
        if not isinstance(reply, dict) or "error" in reply:
            return None
        scores.update({s["id"]: s["score"] for s in reply.get("scores") or []})
    return scores


def answer_prompt(query: str, passages: list) -> str:
    blocks = "\n".join(f"[{p['id']}] {p['text']}" for p in passages)
    return ("Answer the customer's question from these passages only.\n"
            f"Question: {query}\n{blocks}\n"
            "Reply as Final Answer: <answer>.")


def run_agent(question: str, llm, tools: dict) -> str:
    query = json.loads(question)["query"]
    found = tools["search"](query=query) or {}
    candidates = unique(found.get("candidates") or [])
    scores = rerank_scores(query, candidates, tools)
    if scores is None:
        top = candidates[:TOP]
    else:
        scored = [c for c in candidates if c["id"] in scores]
        top = sorted(scored, key=lambda c: -scores[c["id"]])[:TOP]
    reply = llm(answer_prompt(query, top))
    return json.dumps({
        "top": [p["id"] for p in top],
        "reranked": scores is not None,
        "answer": reply.split("Final Answer:", 1)[-1].strip(),
    })

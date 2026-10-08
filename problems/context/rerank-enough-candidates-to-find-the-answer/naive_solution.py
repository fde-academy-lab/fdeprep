"""What an unprepared learner writes in four minutes.

It hands the reranker the whole fused list in one call. The reranker reads
eight passages a call, so everything after the eighth is never scored, and a
passage further down the list never reaches the model however well it
answers. Repeated ids go to the reranker as they come.

It does fall back to the fused order when the reranker times out, because a
public case shows that. It reads only the first reply, so a reranker that
fails on a later call never comes up.
"""

import json


def answer_prompt(query: str, passages: list) -> str:
    blocks = "\n".join(f"[{p['id']}] {p['text']}" for p in passages)
    return ("Answer the customer's question from these passages only.\n"
            f"Question: {query}\n{blocks}\n"
            "Reply as Final Answer: <answer>.")


def run_agent(question: str, llm, tools: dict) -> str:
    query = json.loads(question)["query"]
    candidates = tools["search"](query=query)["candidates"]

    reply = tools["rerank"](query=query, ids=[c["id"] for c in candidates])
    if "error" in reply:
        top, reranked = candidates[:3], False
    else:
        by_id = {c["id"]: c for c in candidates}
        best = sorted(reply["scores"], key=lambda s: s["score"], reverse=True)[:3]
        top, reranked = [by_id[s["id"]] for s in best], True

    answer = llm(answer_prompt(query, top))
    return json.dumps({"top": [c["id"] for c in top], "reranked": reranked,
                       "answer": answer.split("Final Answer:", 1)[-1].strip()})

"""What an unprepared learner writes in four minutes.

It applies both floors, writes the profile and the Skipped line, which is
much of the contract. Then it pools the notes and the index results and
sorts the pool by score, so a note matching two words outranks any index
result, ties stay in the order the stores sent them, a memory saved in both
stores takes two places, and a memory about the risk profile sits beside
the profile itself. A store that raises takes the whole answer down with it.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    fields = tools["profile"]().get("fields") or {}
    hits = tools["notes"](query=question).get("hits") or []
    results = tools["index"](query=question).get("results") or []

    pool = [(hit["matched"], "notes", hit) for hit in hits if hit["matched"] >= 2]
    pool += [(result["similarity"], "index", result) for result in results
             if result["similarity"] >= 0.75]
    pool.sort(key=lambda entry: entry[0], reverse=True)
    top = pool[:4]

    skipped = {}
    if not fields:
        skipped["profile"] = "nothing_relevant"
    for store in ("notes", "index"):
        if not any(entry[1] == store for entry in top):
            skipped[store] = "nothing_relevant"

    lines = ["Profile:"]
    lines += [f"{field}: {fields[field]}" for field in sorted(fields)] or ["- none"]
    lines.append("Memories:")
    lines += [f"[{entry[2]['id']}] {entry[2]['text']}" for entry in top] or ["- none"]
    if skipped:
        lines.append("Skipped: " + ", ".join(f"{s} ({r})" for s, r in skipped.items()))
    lines.append(f"Question: {question}")

    reply = llm("\n".join(lines)).strip()
    return json.dumps({"answer": reply, "memories": [entry[2]["id"] for entry in top],
                       "skipped": skipped})

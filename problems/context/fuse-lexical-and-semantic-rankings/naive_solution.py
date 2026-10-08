"""What an unprepared learner writes in four minutes.

It calls both searches, pools the results and sorts the pool by score.
Keyword scores run to about 20 and vector scores stop at 1, so the sort keeps
keyword search's top three every time, and a chunk that both searches rank
fourth never reaches the prompt.
"""

import json
import re

TOP = 3


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*search\(query=(.*?)\)", output)
        if action is None:
            continue

        query = action.group(1).strip()
        pool = (tools["keyword_search"](query=query).get("results", [])
                + tools["vector_search"](query=query).get("results", []))

        best, seen = [], set()
        for item in sorted(pool, key=lambda r: r["score"], reverse=True):
            if item["id"] not in seen:
                seen.add(item["id"])
                best.append(item)

        blocks = "\n".join(f"[{r['id']}] {r['text']}" for r in best[:TOP])
        scratchpad += f"{output}\n{blocks}\n"

    return "I could not find that in the knowledge base."

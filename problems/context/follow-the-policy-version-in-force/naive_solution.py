"""What an unprepared learner writes in four minutes.

It takes the two best-scoring chunks, labels them the way the contract asks
and records them as followed. It never compares a version's date with the
as-of date, so when last year's policy outranks its replacement both reach
the prompt, and the model follows the one it reads first.
"""

import json
import re

NOTHING = "I could not find a policy that covers this."


def run_agent(question: str, llm, tools: dict) -> str:
    text = question.split("|", 1)[-1]
    scratchpad = f"Question: {text}\n"
    followed = []

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            return json.dumps({"answer": answer, "followed": followed, "set_aside": {}})

        action = re.search(r"Action:\s*search\(query=(.*?)\)", output)
        if action is None:
            continue

        chunks = tools["search"](query=action.group(1).strip()).get("chunks", [])
        if not chunks:
            return json.dumps({"answer": NOTHING, "followed": [], "set_aside": {}})

        top = sorted(chunks, key=lambda c: c["score"], reverse=True)[:2]
        followed = [c["id"] for c in top]
        scratchpad += f"{output}\n" + "\n".join(
            f"[{c['id']} | {c['doc']} | in force from {c['effective_from']}] {c['text']}"
            for c in top
        ) + "\n"

    return json.dumps({"answer": NOTHING, "followed": [], "set_aside": {}})

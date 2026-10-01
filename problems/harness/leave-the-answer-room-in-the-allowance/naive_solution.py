"""What an unprepared learner writes in four minutes.

It drops context in rank order, which is right, and it measures with the rule
of thumb everyone knows, four characters to a token, against the whole
allowance. English tickets come out close enough. A Hindi ticket costs several
times what its length suggests, and nothing is set aside for the answer, so the
answer gets whatever room the prompt leaves and is cut off mid-JSON.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    parts = tools["prompt_parts"](ticket=question)
    blocks = list(parts["blocks"])

    def estimate(kept):
        return sum(len(block["text"]) // 4 for block in kept)

    while estimate(blocks) > parts["allowance"]:
        context = [b for b in blocks if b["kind"] == "context"]
        if not context:
            break
        blocks.remove(max(context, key=lambda b: b["rank"]))

    return llm("\n\n".join(block["text"] for block in blocks))

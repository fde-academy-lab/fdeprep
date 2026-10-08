"""What an unprepared learner writes in four minutes.

It takes the first five results as search returned them. When five product
pages carry the same paragraph, the first five are that paragraph five times,
and the chunk that answers the question ranks sixth and never reaches the
prompt.
"""

import json
import re

MAX_BLOCKS = 5


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*search\(query=(.*?)\)", output)
        if action is None:
            continue

        result = tools["search"](query=action.group(1).strip())
        top = result.get("chunks", [])[:MAX_BLOCKS]
        scratchpad += f"{output}\n" + "\n".join(f"[{c['id']}] {c['text']}" for c in top) + "\n"

    return "I could not find that in the policy wording."

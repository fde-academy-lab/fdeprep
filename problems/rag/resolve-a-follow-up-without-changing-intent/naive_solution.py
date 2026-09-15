"""What an unprepared learner writes in four minutes.

It puts the conversation in the prompt and asks the model to rewrite the
follow-up. The conversation is the session, the session is the queue, and the
queue holds other customers, so "the other one" resolves to whichever order id
happens to be nearest.
"""

import json
import re

ASK = "I need to know which order you mean."


def run_agent(question: str, llm, tools: dict) -> str:
    found = re.match(r"customer=([^|]+)\|(.*)", question, re.DOTALL)
    customer, text = (found.group(1).strip(), found.group(2).strip()) if found else ("", question)
    scratchpad = f"Customer: {customer}\nQuestion: {text}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        if "Rewrite:" in output:
            query = output.split("Rewrite:", 1)[1].strip()
            result = tools["search"](query=query) or {}
            scratchpad += f"{output}\nEvidence: {json.dumps(result.get('chunks') or [])}\n"
            continue

        action = re.search(r"Action:\s*(\w+)\(", output, re.MULTILINE)
        if action is None:
            continue

        result = tools[action.group(1)]() or {}
        turns = result.get("turns") or []
        lines = "\n".join(f"[{t.get('n')}] {t.get('text', '')}" for t in turns)
        scratchpad += (
            f"{output}\n<conversation>\n{lines}\n</conversation>\n"
            "Reply with Rewrite: followed by a standalone query.\n"
        )

    return ASK

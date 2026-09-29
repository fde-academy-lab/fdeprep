"""What an unprepared learner writes in four minutes.

It checks that every sentence carries a citation and that each cited id is a
chunk search returned. That catches an invented id and nothing else. A
sentence that cites a real chunk and changes the number in it passes, because
the check asks whether the source exists and never what it says.
"""

import json
import re

CANNOT_CHECK = "I could not check that answer against the mortgage terms."


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"
    retrieved = set()

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            draft = output.split("Final Answer:", 1)[1].strip()
            kept = []
            for sentence in re.split(r"(?<=\.)\s+", draft):
                ids = re.findall(r"\[([^\]]+)\]", sentence)
                if ids and all(i in retrieved for i in ids):
                    kept.append(sentence)
            return " ".join(kept) or CANNOT_CHECK

        action = re.search(r"Action:\s*search\(query=(.*?)\)", output)
        if action is None:
            continue

        chunks = tools["search"](query=action.group(1).strip()).get("chunks", [])
        retrieved |= {c["id"] for c in chunks}
        scratchpad += f"{output}\n" + "\n".join(f"[{c['id']}] {c['text']}" for c in chunks) + "\n"

    return CANNOT_CHECK

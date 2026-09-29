"""What an unprepared learner writes in four minutes.

It sorts the candidates by score and takes the top three, which is what every
retrieval example does. Equal scores keep the order the shards answered in,
so a tie can go either way on the next call. A note saved twice takes two
slots, and nothing asks whose conversation this is.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    found = tools["recall"](query=question) or {}
    memories = sorted(found.get("memories") or [], key=lambda m: m.get("score", 0), reverse=True)

    lines = [f"- {m.get('text')}" for m in memories[:3]] or ["- none"]
    prompt = "Memories:\n" + "\n".join(lines) + f"\nQuestion: {question}"
    return llm(prompt).strip()

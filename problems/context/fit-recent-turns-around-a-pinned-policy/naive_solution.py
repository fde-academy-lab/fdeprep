"""What an unprepared learner writes in four minutes.

It puts the policy on top of the chat and trims from the top until the total
fits the window, which is what every chat window does. The policy is the oldest
block in that list, so it is the first one trimmed, and a long chat reaches the
model with no policy at all.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    context = tools["conversation"]() or {}
    window = context.get("window", 0)
    policy = context.get("policy") or {}
    blocks = [policy] + (context.get("turns") or [])

    while blocks and sum(block.get("tokens", 0) for block in blocks) > window:
        blocks.pop(0)

    lines = [
        f"{block['role']}: {block['text']}" if "role" in block else block.get("text", "")
        for block in blocks
    ]
    lines.append(f"customer: {question}")
    return llm("\n".join(lines)).strip()

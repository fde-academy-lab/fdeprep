"""What an unprepared learner writes in four minutes.

It follows the priority and never cuts an item, which is most of the
contract. It walks every kind of item the same way, skipping what does not
fit and carrying on, so an older turn is taken after a newer one was left
out. It adds the Left out line after packing without paying for it, and it
reads a missing token count as zero.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    context = tools["context"]() or {}
    window = context.get("window", 0)
    items = context.get("items") or []

    instructions = [i for i in items if i.get("kind") == "instruction"]
    others = [i for i in items if i.get("kind") != "instruction"]
    used = sum(i.get("tokens", 0) for i in instructions)

    order = ([i for i in reversed(items) if i.get("kind") == "tool_result"]
             + [i for i in reversed(items) if i.get("kind") == "turn"]
             + sorted([i for i in items if i.get("kind") == "passage"],
                      key=lambda i: i.get("rank", 99)))

    taken = set()
    for item in order:
        tokens = item.get("tokens", 0)
        if used + tokens <= window:
            taken.add(item["id"])
            used += tokens

    left_out = [i["id"] for i in others if i["id"] not in taken]
    lines = [f"[{i['id']}] {i['text']}" for i in instructions]
    lines += [f"[{i['id']}] {i['text']}" for i in others if i["id"] in taken]
    if left_out:
        lines.append("Left out: " + ", ".join(left_out))
    lines.append(f"Question: {question}")

    reply = llm("\n".join(lines)).strip()
    included = [i["id"] for i in instructions] + [i["id"] for i in others if i["id"] in taken]
    return json.dumps({"answer": reply, "included": included, "left_out": left_out})

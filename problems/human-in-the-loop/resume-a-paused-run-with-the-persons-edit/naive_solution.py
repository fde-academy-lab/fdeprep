"""What an unprepared learner writes in four minutes.

It resumes from the checkpoint instead of starting again, which is the half
of the lesson everyone already knows, and it swaps the person's arguments
into the paused step before running it. Then it carries on with the record
exactly as the checkpoint left it, and the checkpoint holds the paused step
as the model first proposed it. So the model writes every later step from a
salary nobody approved. A rejection carries no arguments, so the original
step runs, and an edit made for an earlier step lands on whichever step
happens to be paused.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    checkpoint = tools["checkpoint"](run=question)
    paused = checkpoint["paused"]
    decision = checkpoint["decision"]

    lines = [f"Request: {checkpoint['request']}"]
    for step in checkpoint["ran"] + [paused]:
        lines.append(f"Ran: {step['tool']} {json.dumps(step['args'])}")

    tools[paused["tool"]](**(decision.get("args") or paused["args"]))
    ran = [paused["tool"]]

    summary = ""
    for _ in range(5):
        reply = llm("\n".join(lines)).strip()
        if reply.startswith("Done"):
            summary = reply.split(":", 1)[-1].strip()
            break
        step = json.loads(reply[len("Step:"):])
        tools[step["tool"]](**step["args"])
        ran.append(step["tool"])
        lines.append(f"Ran: {step['tool']} {json.dumps(step['args'])}")

    return json.dumps({"outcome": "completed", "ran": ran, "refused": [], "summary": summary})

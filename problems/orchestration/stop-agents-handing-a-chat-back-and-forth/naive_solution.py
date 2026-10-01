"""What an unprepared learner writes in four minutes.

It follows every handoff and carries the notes, which handles every chat
that ends in an answer. Nothing records the handoffs already made or counts
them, so two specialists that keep handing the chat to each other run until
the model budget refuses a call, and that refusal escapes with nobody told.
"""

import json

SPECIALISTS = ("billing", "devices", "plans", "returns")


def specialist_prompt(name: str, message: str, notes: list) -> str:
    lines = [
        f"Specialist: {name}",
        "You are one of four specialists: billing, devices, plans and returns.",
        f"Customer: {message}",
    ]
    for note in notes:
        lines.append(f"Note from {note['from']}: {note['reason']}")
    lines.append("Reply 'Answer: <reply to the customer>' or "
                 "'Handoff: <specialist> | <reason>'.")
    return "\n".join(lines)


def read_reply(reply: str):
    text = (reply or "").strip()
    if text.startswith("Answer:"):
        return ("answer", text[len("Answer:"):].strip())
    if text.startswith("Handoff:"):
        target, sep, reason = text[len("Handoff:"):].partition("|")
        if sep and target.strip() in SPECIALISTS:
            return ("handoff", (target.strip(), reason.strip()))
    return None


def run_agent(question: str, llm, tools: dict) -> str:
    chat = json.loads(question)
    current, notes = chat["first"], []
    while True:
        kind, value = read_reply(llm(specialist_prompt(current, chat["message"], notes)))
        if kind == "answer":
            return value
        target, reason = value
        notes.append({"from": current, "reason": reason})
        current = target

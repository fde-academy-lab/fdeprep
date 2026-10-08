"""Reference solution for stop-agents-handing-a-chat-back-and-forth.

Every handoff a specialist asks for is recorded as it happens. A handoff
that repeats one already made in the chat means a specialist looked at
everything it had and decided the same thing again, so the chat is going
round. A return to a specialist is not a repeat, because it can carry a new
note. The cap catches a chain that never repeats. Whatever stops the chat, a
failed call included, a person gets the whole history and the reason.
"""

import json

SPECIALISTS = ("billing", "devices", "plans", "returns")
MAX_HANDOFFS = 4


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
    message = chat.get("message", "")
    current = chat.get("first")
    notes: list = []
    history: list = []
    made: set = set()

    def to_a_person(why: str) -> str:
        result = tools["human"](chat=chat.get("chat"), message=message,
                                history=history, why=why)
        return str(result.get("reply", "")) if isinstance(result, dict) else ""

    while True:
        try:
            reply = read_reply(llm(specialist_prompt(current, message, notes)))
        except Exception:
            # A refused or failing call stops the chat like any other rule.
            reply = None
        if reply is None:
            return to_a_person("no usable reply")
        kind, value = reply
        if kind == "answer":
            return value

        target, reason = value
        history.append({"from": current, "to": target, "reason": reason})
        if (current, target) in made:
            return to_a_person("loop")
        if len(history) > MAX_HANDOFFS:
            return to_a_person("too many handoffs")
        made.add((current, target))
        notes.append({"from": current, "reason": reason})
        current = target

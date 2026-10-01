"""Reference solution for separate-missing-from-null-parameters.

An absent key and a key holding null are two different facts, and dict.get()
reads both as None. So membership is tested before any value is read: a key
the model left out means the message never covered that field, and a key
holding null is the customer's answer.

Whether null is allowed is data on the field, next to its name. A redelivery
needs a day, so a null date still needs a question. The booking passes nulls
through unchanged, because null is what the customer asked for.
"""

import json

FIELDS = (
    ("date", False),          # (name, may be null)
    ("time_window", True),
    ("safe_place", True),
)


def build_prompt(message: str) -> str:
    return (
        "Read the customer's redelivery request. Reply with a JSON object. "
        "Include date, time_window and safe_place only when the message "
        "covers them, and use null where the customer said any time, or said "
        "not to leave the parcel anywhere.\n\n"
        f"Message: {message}\n"
    )


def needs_asking(name: str, nullable: bool, extracted: dict) -> bool:
    """True when the customer still has to be asked about this field."""
    if name not in extracted:
        return True
    return extracted[name] is None and not nullable


def run_agent(question: str, llm, tools: dict) -> str:
    extracted = json.loads(llm(build_prompt(question)))
    if not isinstance(extracted, dict):
        extracted = {}

    ask_about = [name for name, nullable in FIELDS
                 if needs_asking(name, nullable, extracted)]
    if ask_about:
        return json.dumps({"action": "ask", "ask_about": ask_about})

    details = {name: extracted[name] for name, _ in FIELDS}
    booking = tools["book_redelivery"](**details) or {}
    return json.dumps({
        "action": "booked",
        "booking_ref": booking.get("booking_ref"),
        "details": details,
    })

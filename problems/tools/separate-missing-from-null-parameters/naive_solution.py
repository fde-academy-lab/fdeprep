"""What an unprepared learner writes in four minutes.

It reads every field with .get(), which answers None for a key the model left
out and for a key the model set to null. A safe place nobody mentioned then
looks exactly like "do not leave it anywhere", so the parcel is booked without
anyone asking where it can go.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    fields = json.loads(llm(
        "Read this redelivery request and reply with JSON holding date, "
        f"time_window and safe_place.\n\n{question}"
    ))

    if not fields.get("date"):
        return json.dumps({"action": "ask", "ask_about": ["date"]})

    details = {
        "date": fields.get("date"),
        "time_window": fields.get("time_window"),
        "safe_place": fields.get("safe_place"),
    }
    booking = tools["book_redelivery"](**details)
    return json.dumps({
        "action": "booked",
        "booking_ref": booking.get("booking_ref"),
        "details": details,
    })

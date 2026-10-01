"""What an unprepared learner writes in four minutes.

It applies the table in order, which is most of the contract. Its card check
wants sixteen digits in a row, the one way customers rarely type a card, and
its code check listens for the word OTP alone, so a verification code is
kept and a message about OTP settings is refused.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    candidates = (tools["candidates"]() or {}).get("candidates") or []

    decisions = {}
    for candidate in candidates:
        text = candidate.get("text", "")
        if re.search(r"\d{16}", text):
            decision = {"store": False, "reason": "card_number"}
        elif "otp" in text.lower():
            decision = {"store": False, "reason": "one_time_code"}
        elif not candidate.get("confirmed"):
            decision = {"store": False, "reason": "unconfirmed"}
        elif candidate.get("kind") == "preference":
            decision = {"store": True, "reason": "preference"}
        elif candidate.get("kind") == "fact":
            decision = {"store": True, "reason": "confirmed_fact"}
        else:
            decision = {"store": False, "reason": "one_off"}
        decisions[candidate["id"]] = decision
    return json.dumps(decisions)

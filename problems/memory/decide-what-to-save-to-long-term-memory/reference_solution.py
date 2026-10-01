"""Reference solution for decide-what-to-save-to-long-term-memory.

The extraction model proposes and this gate decides. The text is read for
card numbers and one-time codes before the label or the confirmation is
looked at, because the label is the extraction model's guess and the
review found card numbers filed as preferences. The first rule that matches
decides, so a card number in an unconfirmed note is refused as a card
number, which is the reason the next review needs to read.

A card number is any run of 13 to 19 digits with at most one space or
hyphen between two of them, which covers groups of four, hyphens and an
Amex's four, six and five. A one-time code needs both a code word and a run
of 4 to 8 digits, so a postal PIN, a phone number and a message about OTP
settings are all kept.
"""

import json
import re

CODE_WORDS = ("otp", "one-time", "verification code", "security code")
CARD = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")
SHORT_RUN = re.compile(r"(?<!\d)\d{4,8}(?!\d)")


def holds_card_number(text: str) -> bool:
    """True when text holds 13 to 19 digits in a row, where a single space or
    hyphen may sit between two digits."""
    return CARD.search(text) is not None


def holds_one_time_code(text: str) -> bool:
    """True when text holds a run of 4 to 8 digits and also says one of
    CODE_WORDS, in any case."""
    lowered = text.lower()
    return any(word in lowered for word in CODE_WORDS) and SHORT_RUN.search(text) is not None


def decide(candidate: dict) -> dict:
    """{"store": ..., "reason": ...} from the first rule in the contract's
    table that matches."""
    text = str(candidate.get("text") or "")
    if holds_card_number(text):
        return {"store": False, "reason": "card_number"}
    if holds_one_time_code(text):
        return {"store": False, "reason": "one_time_code"}
    if candidate.get("confirmed") is not True:
        return {"store": False, "reason": "unconfirmed"}
    if candidate.get("kind") == "preference":
        return {"store": True, "reason": "preference"}
    if candidate.get("kind") == "fact":
        return {"store": True, "reason": "confirmed_fact"}
    return {"store": False, "reason": "one_off"}


def run_agent(question: str, llm, tools: dict) -> str:
    result = tools["candidates"]() or {}
    candidates = result.get("candidates") if isinstance(result, dict) else None
    if not isinstance(candidates, list):
        return json.dumps({})

    decisions = {}
    for candidate in candidates:
        if isinstance(candidate, dict) and "id" in candidate:
            decisions[str(candidate["id"])] = decide(candidate)
    return json.dumps(decisions)

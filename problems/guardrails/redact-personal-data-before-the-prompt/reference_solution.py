"""Reference solution for redact-personal-data-before-the-prompt.

Redaction happens before the prompt exists, over every string in the ticket
at any depth. Each distinct value becomes a numbered placeholder, and a map
from placeholder back to value stays in this process: it never goes into the
prompt, the draft or a log.

The draft comes back with placeholders in it, and the map puts them back by
the data protection team's rules. An email address or a phone number returns
as it was, because the draft goes to the person it belongs to. A card number
returns as its last four digits, even to the customer who typed it.
"""

import json
import re

# Cards first, so no other pattern gets a chance to bite into a card number.
PATTERNS = (
    ("CARD", re.compile(r"\b(?:\d{4}[ -]){3}\d{4}\b")),
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("PHONE", re.compile(r"(?:\+44\s?7\d{3}|\b07\d{3})\s?\d{3}\s?\d{3}\b")),
)
PLACEHOLDER = re.compile(r"\[(?:CARD|EMAIL|PHONE)_\d+\]")


class Redactor:
    def __init__(self):
        self.originals = {}      # "[EMAIL_1]" -> the address it stands for
        self._assigned = {}      # (kind, value) -> placeholder
        self._counts = {}        # kind -> how many placeholders so far

    def _placeholder(self, kind: str, value: str) -> str:
        key = (kind, value)
        if key not in self._assigned:
            self._counts[kind] = self._counts.get(kind, 0) + 1
            placeholder = f"[{kind}_{self._counts[kind]}]"
            self._assigned[key] = placeholder
            self.originals[placeholder] = value
        return self._assigned[key]

    def redact(self, value):
        """The same structure with every personal value swapped for its placeholder."""
        if isinstance(value, str):
            for kind, pattern in PATTERNS:
                value = pattern.sub(lambda m, kind=kind: self._placeholder(kind, m.group(0)), value)
            return value
        if isinstance(value, dict):
            return {key: self.redact(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        return value

    def restore(self, draft: str) -> str:
        def back(match):
            placeholder = match.group(0)
            original = self.originals.get(placeholder)
            if original is None:
                return placeholder
            if placeholder.startswith("[CARD_"):
                digits = re.sub(r"\D", "", original)
                return f"card ending {digits[-4:]}"
            return original

        return PLACEHOLDER.sub(back, draft)


def run_agent(question: str, llm, tools: dict) -> str:
    ticket = tools["read_ticket"]() or {}
    redactor = Redactor()
    safe = redactor.redact(ticket)

    reply = llm(f"{question}\n\nTicket:\n{json.dumps(safe)}\n")
    if "Final Answer:" not in reply:
        return ("I could not draft a reply without sending personal data to the model. "
                "This ticket needs a person.")

    draft = reply.split("Final Answer:", 1)[1].strip()
    return redactor.restore(draft)

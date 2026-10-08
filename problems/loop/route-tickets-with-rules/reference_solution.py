"""Reference solution for route-tickets-with-rules.

A phrase counts only as whole words, so "late" never fires inside
"chocolate". Every queue is checked before anything is returned, because a
ticket that names two problems is a decision a person should make, and the
order of a dictionary is not a decision.
"""

import re

QUEUES = {
    "refunds": ["refund", "charged twice", "money back"],
    "late_delivery": ["late", "still waiting", "not arrived"],
    "account": ["password", "log in", "otp"],
}
HUMAN = "human"


def matches(phrase: str, text: str) -> bool:
    return re.search(rf"\b{re.escape(phrase)}\b", text, re.IGNORECASE) is not None


def run_agent(question: str, llm, tools: dict) -> str:
    hits = [queue for queue, phrases in QUEUES.items()
            if any(matches(phrase, question) for phrase in phrases)]
    if len(hits) == 1:
        return hits[0]
    return HUMAN

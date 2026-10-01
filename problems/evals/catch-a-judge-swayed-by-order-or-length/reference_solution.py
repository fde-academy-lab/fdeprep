"""Reference solution for catch-a-judge-swayed-by-order-or-length.

A verdict counts when it survives two changes that should not matter: the
order the answers are shown in, and their length. Each pair is asked in both
orders, and each reply is mapped from the position it names back to the
version it names before the two are compared. A winner with more words than
the loser is checked again with the loser padded by a sentence that adds
nothing, in both orders. A verdict that moves, to the other answer or to a
tie, is untrusted and named.

Replies are read strictly. One that is not exactly 1, 2 or tie is not a vote,
and the pair is not asked again, since the same question tends to draw the
same drift. Identical answers are a tie without a call.
"""

import json
import re

JUDGE = (
    "You are comparing two answers to a customer's question.\n"
    "Question: {question}\n"
    "Answer 1: {first}\n"
    "Answer 2: {second}\n"
    "Reply with 1 if answer 1 is better, 2 if answer 2 is better, or tie.\n"
)

PAD = "Please let us know if there is anything else we can help you with today."

READINGS = {"1": "first", "2": "second", "tie": "tie"}
COUNTS = {"a": "a_wins", "b": "b_wins", "tie": "ties", "untrusted": "untrusted"}


def read(reply):
    """first, second or tie, or None for a reply that does not count."""
    text = str(reply).strip().lower()
    if text.endswith("."):
        text = text[:-1].strip()
    return READINGS.get(text)


def ask(llm, question, first, second, shown_first):
    """One judgement, mapped back to the version it names, or None."""
    reading = read(llm(JUDGE.format(question=question, first=first, second=second)))
    if reading is None or reading == "tie":
        return reading
    other = "b" if shown_first == "a" else "a"
    return shown_first if reading == "first" else other


def both_orders(llm, question, a, b):
    """(verdict, None) when both orders agree, or (None, why not)."""
    one = ask(llm, question, a, b, "a")
    if one is None:
        return None, "unreadable"
    two = ask(llm, question, b, a, "b")
    if two is None:
        return None, "unreadable"
    if one != two:
        return None, "position"
    return one, None


def padded(text, words):
    while len(text.split()) < words:
        text = f"{text} {PAD}"
    return text


def judge(llm, pair):
    a, b, question = pair.get("a"), pair.get("b"), pair.get("question", "")
    if not isinstance(a, str) or not isinstance(b, str):
        return "untrusted", "unreadable"
    if a.strip() == b.strip():
        return "tie", None

    winner, doubt = both_orders(llm, question, a, b)
    if doubt:
        return "untrusted", doubt
    if winner == "tie":
        return "tie", None

    texts = {"a": a, "b": b}
    loser = "b" if winner == "a" else "a"
    longest = len(texts[winner].split())
    if longest > len(texts[loser].split()):
        texts[loser] = padded(texts[loser], longest)
        again, doubt = both_orders(llm, question, texts["a"], texts["b"])
        if doubt == "unreadable":
            return "untrusted", "unreadable"
        if again != winner:
            return "untrusted", "length"
    return winner, None


def run_agent(question: str, llm, tools: dict) -> str:
    try:
        batch = tools["pairs"](batch=question)
    except Exception:
        batch = None
    pairs = batch.get("pairs") if isinstance(batch, dict) else None
    if not isinstance(pairs, list):
        pairs = []

    results = []
    counts = {"a_wins": 0, "b_wins": 0, "ties": 0, "untrusted": 0}
    for pair in pairs:
        if not isinstance(pair, dict):
            continue
        verdict, reason = judge(llm, pair)
        results.append({"id": pair.get("id"), "verdict": verdict, "reason": reason})
        counts[COUNTS[verdict]] += 1

    return json.dumps({"pairs": results, **counts})

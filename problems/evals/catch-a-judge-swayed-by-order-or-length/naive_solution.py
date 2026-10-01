"""What an unprepared learner writes in four minutes.

It asks the judge in both orders and maps each reply back to a version,
which catches the judge that always picks the first answer. It stops there.
A longer answer that wins in both orders is taken at its word, so a judge
that prefers length passes every check. It reads a reply by looking for a
digit anywhere in it, so a reply that talks about both answers becomes a
confident vote. And it asks the judge about two identical answers, where the
only thing the reply can show is the judge's bias.
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


def read(reply):
    text = reply.lower()
    if "1" in text:
        return "first"
    if "2" in text:
        return "second"
    return "tie"


def run_agent(question: str, llm, tools: dict) -> str:
    pairs = tools["pairs"](batch=question)["pairs"]
    results = []
    counts = {"a_wins": 0, "b_wins": 0, "ties": 0, "untrusted": 0}

    for pair in pairs:
        one = read(llm(JUDGE.format(question=pair["question"], first=pair["a"], second=pair["b"])))
        two = read(llm(JUDGE.format(question=pair["question"], first=pair["b"], second=pair["a"])))
        first = {"first": "a", "second": "b", "tie": "tie"}[one]
        second = {"first": "b", "second": "a", "tie": "tie"}[two]
        if first == second:
            verdict, reason = first, None
        else:
            verdict, reason = "untrusted", "position"
        results.append({"id": pair["id"], "verdict": verdict, "reason": reason})
        counts[{"a": "a_wins", "b": "b_wins", "tie": "ties", "untrusted": "untrusted"}[verdict]] += 1

    return json.dumps({"pairs": results, **counts})

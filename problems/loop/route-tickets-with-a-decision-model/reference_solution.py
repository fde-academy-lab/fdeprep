"""Reference solution for route-tickets-with-a-decision-model.

The decision model's reply is evidence, and three checks stand between it and
a route: the reply carries a choice at all, the choice is one of the queues,
and the confidence clears the bar. Anything that fails a check goes to a
person, which is what the human queue is for.
"""

QUEUES = ("refunds", "late_delivery", "account")
HUMAN = "human"
BAR = 0.7


def run_agent(question: str, llm, tools: dict) -> str:
    verdict = tools["jev"](ticket=question)
    if not isinstance(verdict, dict) or "error" in verdict:
        return HUMAN
    choice = verdict.get("choice")
    confidence = verdict.get("confidence")
    if choice not in QUEUES:
        return HUMAN
    if not isinstance(confidence, (int, float)) or confidence < BAR:
        return HUMAN
    return choice

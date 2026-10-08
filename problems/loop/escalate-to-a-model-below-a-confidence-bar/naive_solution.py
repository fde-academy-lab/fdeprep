"""What an unprepared learner writes in four minutes.

One bar for every queue, so a refund the decision model is 72 percent sure of
moves money without a second look. A reply that carries an error raises a
KeyError, and the model's reply is returned whole as the route.
"""


def run_agent(question: str, llm, tools: dict) -> str:
    verdict = tools["jev"](ticket=question)
    if verdict["confidence"] >= 0.6:
        return verdict["choice"]
    reply = llm(f"Route this ticket to refunds, late_delivery, account or human: {question}")
    return reply.strip().lower()

"""What an unprepared learner writes in four minutes.

It asks the model for a queue and returns the reply as the route. A reply of
"Queue: Refunds." is not a queue name, a reply that names two queues is
returned whole, and a chatty reply becomes a queue nobody owns.
"""


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(f"Route this ticket to refunds, late_delivery, account or human: {question}")
    return reply.strip().lower()

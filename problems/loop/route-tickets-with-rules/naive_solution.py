"""What an unprepared learner writes in four minutes.

It lowercases the ticket and returns the first queue whose phrase appears
anywhere in it. "late" is found inside "chocolate", and a ticket that names
two problems goes to whichever queue the table lists first.
"""

QUEUES = {
    "refunds": ["refund", "charged twice", "money back"],
    "late_delivery": ["late", "still waiting", "not arrived"],
    "account": ["password", "log in", "otp"],
}


def run_agent(question: str, llm, tools: dict) -> str:
    text = question.lower()
    for queue, phrases in QUEUES.items():
        for phrase in phrases:
            if phrase in text:
                return queue
    return "human"

"""What an unprepared learner writes in four minutes.

It asks the model for the three fields, parses the reply and hands it straight
on. The prompt says to use null for anything missing, so the code trusts that
it will, and an order number the model made up reaches the ticket looking
exactly like a real one.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(
        "Extract order_id, email and phone from this customer email as JSON. "
        f"Use null for anything missing.\n\n{question}"
    )
    return json.dumps(json.loads(reply))

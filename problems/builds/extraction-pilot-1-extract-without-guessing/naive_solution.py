"""What an unprepared learner writes in four minutes.

It asks for the four fields, tells the model to use null for anything the
letter does not state, and hands the reply straight to the claims system. The
instruction is a request. The model fills a field it was asked for with
something plausible, and nothing between its reply and the record checks
whether the letter ever said it.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(
        "Extract policy_number, claimant, incident_date and amount_claimed from "
        "this claim letter as JSON. Use null for anything it does not state.\n\n"
        + question
    )
    return json.dumps(json.loads(reply))

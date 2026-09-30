"""What an unprepared learner writes in four minutes.

It has learned to parse the reply and to ask once more when the text is not
JSON. Anything that parses is treated as the decision, so a record saying
"partial_refund", or an amount sent as the text "45.00", goes to the warehouse
exactly as the model wrote it.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    prompt = (
        "Decide this return request. Reply with JSON holding decision "
        f"(refund, replace or reject), amount_pence and reason.\n\n{question}\n"
    )
    for _ in range(2):
        reply = llm(prompt)
        try:
            return json.dumps({"status": "ok", "record": json.loads(reply)})
        except ValueError:
            prompt += f"\nYour reply was not valid JSON:\n{reply}\nTry again.\n"
    return json.dumps({"status": "needs_review", "record": None, "errors": ["no JSON"]})

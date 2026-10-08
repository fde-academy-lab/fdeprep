"""What an unprepared learner writes in four minutes.

It sends the model's arguments straight to the payments API and, when the API
says no, tells the model the input was invalid. The model cannot tell which
field was wrong, what it sent or what would have been accepted, so it sends the
same call again until the calls run out.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Customer: {question}\n"

    for _ in range(3):
        reply = llm(scratchpad)
        if "Final Answer:" in reply:
            return reply.split("Final Answer:", 1)[1].strip()

        match = re.search(r"Action:\s*refund\((\{.*\})\)", reply, re.DOTALL)
        if match is None:
            continue

        result = tools["refund"](**json.loads(match.group(1)))
        if result.get("status") == 200:
            observation = result
        else:
            observation = {"error": "invalid input"}
        scratchpad += f"{reply}\nObservation: {json.dumps(observation)}\n"

    return "I could not process this refund. A person will pick up your ticket."

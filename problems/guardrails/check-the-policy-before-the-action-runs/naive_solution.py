"""What an unprepared learner writes in four minutes.

It writes the limit into the prompt, which is where the incident's limit
lived, and calls whatever the model proposes. The model reads the limit and
proposes the refund anyway, the refund runs, and the next reply apologises for
going over a limit nothing in the code ever checked.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = (
        "You are a support agent. Tier 1 may refund up to 40 pounds and may not "
        "close accounts.\n"
        f"Customer: {question}\n"
    )

    for _ in range(3):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = json.loads(output.split("Action:", 1)[1])
        name = action["tool"]
        result = tools[name](**action["args"])
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return "I could not complete this request."

"""What an unprepared learner writes in four minutes.

It checks that both fields are present and that the amount is an int. Both
checks look right. isinstance(True, int) is true in Python, so a boolean
amount passes and gets spent as one penny, and nothing looks at keys the tool
does not take.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Request: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\((\{.*\})\)\s*$", output, re.MULTILINE | re.DOTALL)
        if action is None:
            continue

        payload = json.loads(action.group(2))

        if "amount_cents" not in payload or "order_id" not in payload:
            scratchpad += f"{output}\nI did not call refund: a field was missing.\n"
            continue
        if not isinstance(payload["amount_cents"], int):
            scratchpad += f"{output}\nI did not call refund: amount_cents was not a number.\n"
            continue

        result = tools["refund"](**payload)
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return "I could not process this refund."

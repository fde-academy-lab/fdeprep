"""Reference solution for stop-when-the-model-will-not.

The loop has two exits. One belongs to the model and fires on a Final Answer.
The other belongs to this code and fires when the call allowance is spent.

Model calls are counted rather than iterations, so a retry added inside the
body later cannot quietly turn five iterations into eight calls.
"""

import json
import re

MAX_CALLS = 5
_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"
    found = []
    calls = 0

    while calls < MAX_CALLS:
        output = llm(scratchpad)
        calls += 1

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            if answer:
                return answer

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        topic = action.group(2).split("=", 1)[-1].strip()
        result = tools[action.group(1)](topic=topic)
        text = (result or {}).get("text", "")
        found.append(text)
        scratchpad += f"{output}\n<observation>{json.dumps(result)}</observation>\n"

    if found:
        return (
            "I ran out of lookups before I could summarise this. What I found so far: "
            + " ".join(found)
        )
    return "I ran out of lookups before I found anything worth reporting."

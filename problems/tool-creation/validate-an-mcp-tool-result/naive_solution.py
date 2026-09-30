"""What an unprepared learner writes in four minutes.

It knows MCP results carry structuredContent, uses it when it is there, and
falls back to the text blocks when it is not. Nothing compares
structuredContent with the schema the tool declared, and nothing looks at
whether the call reported a failure, so a null count and a failed call's
zeroes both reach the model as stock levels.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(3):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = re.search(r"Action:\s*(\w+)\((.*?)\)\s*$", output, re.MULTILINE)
        if action is None:
            continue

        args = {}
        for pair in action.group(2).split(","):
            if "=" in pair:
                key, value = pair.split("=", 1)
                args[key.strip()] = value.strip()

        result = tools[action.group(1)](**args)
        data = result.get("structuredContent")
        if data is None:
            data = " ".join(block.get("text", "") for block in result.get("content", []))
        scratchpad += f"{output}\nObservation: {json.dumps(data)}\n"

    return "I could not check the stock."

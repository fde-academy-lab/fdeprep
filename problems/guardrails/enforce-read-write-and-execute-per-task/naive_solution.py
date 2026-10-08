"""What an unprepared learner writes in four minutes.

It reads the task's grants as a set of permission names and lets a call
through when the set holds everything the registry lists for the tool. That
stops the read-only task from building the index. It also counts an execute
grant whoever signed it, or nobody, reads a tool missing from the registry as
a tool that needs nothing, crashes when the registry does not answer, and
tells the model every permission a tool needs where the model needed the one
the task is missing.
"""

import json
import re

ACTION = re.compile(r"Action:\s*(\{.*\})", re.DOTALL)


def run_agent(question: str, llm, tools: dict) -> str:
    task = tools["task"]()
    registry = tools["registry"]()["tools"]
    granted = {grant["permission"] for grant in task["grants"]}
    scratchpad = f"Request: {question}\nThis task holds: {', '.join(sorted(granted))}\n"
    called, refused = [], []

    for _ in range(4):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            return json.dumps({"answer": answer, "called": called, "refused": refused})

        action = json.loads(ACTION.search(output).group(1))
        tool, args = action["tool"], action.get("args", {})
        needed = registry.get(tool, [])
        if all(permission in granted for permission in needed):
            result = tools[tool](**args)
            called.append(tool)
            scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"
        else:
            refused.append({"tool": tool, "missing": needed})
            scratchpad += f"{output}\nRefused: {tool} is missing {', '.join(needed)}.\n"

    return json.dumps({"answer": None, "called": called, "refused": refused})

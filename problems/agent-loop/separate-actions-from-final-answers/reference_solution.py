"""Reference solution for separate-actions-from-final-answers.

The loop classifies the whole reply before it acts on any part of it. Both
markers present means the model made two moves at once and neither is safe to
run, so the reply goes back with a line saying it was not usable. Neither
marker present is the same case with different symptoms.

The line appended on an unusable reply is what keeps the budget: it changes
the prompt, so the next call asks a different question instead of the same one.
"""

import json
import re

_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)
_FINAL = re.compile(r"Final Answer:\s*(.*)")


def _arguments(raw: str) -> dict:
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(8):
        output = llm(scratchpad)

        action = _ACTION.search(output)
        final = _FINAL.search(output)

        if action is not None and final is not None:
            scratchpad += (
                f"{output}\nThat was not a valid action. A reply is either an "
                "action or an answer, never both.\n"
            )
            continue

        if final is not None:
            answer = final.group(1).strip()
            if answer:
                return answer
            scratchpad += f"{output}\nThat was not a valid action. The answer was empty.\n"
            continue

        if action is None:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        name = action.group(1)
        if name not in tools:
            scratchpad += f"{output}\nThat was not a valid action. There is no tool called {name}.\n"
            continue

        result = tools[name](**_arguments(action.group(2)))
        scratchpad += f"{output}\n<observation>{json.dumps(result)}</observation>\n"

    return "I could not finish this booking."

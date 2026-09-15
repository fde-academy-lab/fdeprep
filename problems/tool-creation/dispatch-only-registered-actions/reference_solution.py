"""Reference solution for dispatch-only-registered-actions.

The tools dict is the allowlist. Nothing is called before its name is checked
against it, and a name that is not there produces a line in the scratchpad
naming the refused tool rather than an exception.

Naming it is the part that matters. A refusal the model cannot read leaves the
next prompt identical to the last one, so the model asks for the same missing
tool again until the budget is gone.
"""

import json
import re

_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)


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

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            if answer:
                return answer
            scratchpad += f"{output}\nThat answer was empty.\n"
            continue

        action = _ACTION.search(output)
        if action is None:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        name = action.group(1)
        if name not in tools:
            scratchpad += (
                f"{output}\nThere is no tool called {name}. The tools available are "
                f"{', '.join(sorted(tools))}.\n"
            )
            continue

        result = tools[name](**_arguments(action.group(2)))
        scratchpad += f"{output}\n<observation>{json.dumps(result)}</observation>\n"

    return "I could not complete this request."

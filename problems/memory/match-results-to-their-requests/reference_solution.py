"""Reference solution for match-results-to-their-requests.

The join is on the ref each result carries, never on its position in the list.
The batch endpoint returns results as carriers reply and has never promised an
order, so position carries no information at all.

Lines are written per requested id rather than per returned result, which is
what keeps a slow carrier from silently renumbering the whole answer. An id
the response left out gets a line saying unknown.
"""

import json
import re

_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)


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
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        raw = action.group(2).split("=", 1)[-1]
        asked = [part.strip() for part in raw.split(",") if part.strip()]

        result = tools[action.group(1)](ids=raw.strip())
        by_ref = {
            str(entry.get("ref")): entry.get("state", "unknown")
            for entry in (result or {}).get("results") or []
        }

        lines = "\n".join(f"{ref}={by_ref.get(ref, 'unknown')}" for ref in asked)
        scratchpad += f"{output}\n<statuses>\n{lines}\n</statuses>\n"

    return "I could not check those orders."

"""Reference solution for give-every-observation-a-stable-envelope.

Every result reaches the model in one shape that says what happened, so the
model never has to infer success from whatever type a tool's author chose.
None, an empty string and an empty collection are empty, which is an answer.
A raise and an error body are errors, and each carries a short code.

The code is all that crosses. An exception's message and an error body's
detail are written for whoever reads the logs, and they can hold anything: a
hostname, a stack trace, a password in a connection string. The model can act
on "timeout" without any of that.
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


def _wrap(name: str, outcome: str, data=None, error=None) -> dict:
    return {"tool": name, "outcome": outcome, "data": data, "error": error}


def envelope(name: str, tool, args: dict) -> dict:
    try:
        result = tool(**args)
    except TimeoutError:
        return _wrap(name, "error", error="timeout")
    except Exception:
        return _wrap(name, "error", error="raised")

    if isinstance(result, dict) and result.get("error"):
        return _wrap(name, "error", error="reported")
    if result is None or (isinstance(result, (str, list, dict)) and not result):
        return _wrap(name, "empty")
    return _wrap(name, "ok", data=result)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(3):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            if answer:
                return answer
            scratchpad += f"{output}\nThat answer was empty.\n"
            continue

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a tool you have.\n"
            continue

        name = action.group(1)
        wrapped = envelope(name, tools[name], _arguments(action.group(2)))
        scratchpad += f"{output}\n{json.dumps(wrapped, default=str)}\n"

    return "I could not answer that."

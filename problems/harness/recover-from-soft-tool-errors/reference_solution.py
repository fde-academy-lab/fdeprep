"""Reference solution for recover-from-soft-tool-errors.

Three things separate this from the naive loop. It reads the body rather than
the status code, so an `error` key inside a 200 registers as a failure. It
changes the scratchpad before retrying, because an identical prompt returns an
identical reply. It returns a sentence when the retry also fails.

Observations are wrapped in a delimiter and instruction-shaped text is removed
before anything a tool returned reaches the model, so a tool that answers with
"ignore previous instructions" hands the model nothing to act on.
"""

import json
import re

_ACTION = re.compile(r"Action:\s*(\w+)\((.*)\)\s*$")
_INSTRUCTION = re.compile(
    r"(?is)\b(?:ignore|disregard|forget)\b[^.\n]*?"
    r"\b(?:instruction|instructions|previous|prior|above)\b[^.\n]*\.?"
)


def _parse_action(output: str):
    found = _ACTION.match(output.strip())
    if found is None:
        return None
    args = {}
    for pair in found.group(2).split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return found.group(1), args


def _failed(result) -> bool:
    """A failure can arrive inside a body that reports success."""
    if result is None:
        return True
    if isinstance(result, dict):
        if "error" in result and result["error"]:
            return True
        body = result.get("body")
        if isinstance(body, dict) and body.get("error"):
            return True
    return False


def _observation(result) -> str:
    try:
        text = json.dumps(result)
    except (TypeError, ValueError):
        text = str(result)
    return _INSTRUCTION.sub("[instruction removed]", text)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"
    retried = False

    for _ in range(3):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            return answer or "The tool answered, but with nothing in it."

        action = _parse_action(output)
        if action is None:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        name, args = action
        if name not in tools:
            scratchpad += f"{output}\nThere is no tool called {name}.\n"
            continue

        result = tools[name](**args)
        observation = _observation(result)

        if _failed(result):
            if retried:
                return (
                    "The shipping tool reported a failure inside a successful "
                    "response twice, so I could not confirm the status."
                )
            retried = True
            scratchpad += (
                f"{output}\n<observation>{observation}</observation>\n"
                "That call reported an error inside a successful response. "
                "Ask a different way.\n"
            )
            continue

        scratchpad += f"{output}\n<observation>{observation}</observation>\n"

    return "I could not complete this request within the call budget."

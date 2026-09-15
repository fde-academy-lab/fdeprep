"""Reference solution for reject-invalid-action-arguments.

Four checks stand between the model's suggestion and the money: unknown keys,
missing keys, types, and the range.

The type check is `type(value) is int` rather than isinstance, because bool
subclasses int in Python and True would otherwise be spent as one penny. The
range check is where the policy about how much an agent may move without a
person actually lives, which is in dispatching code rather than in an editable
prompt.
"""

import json
import re

MIN_CENTS = 1
MAX_CENTS = 20000

_ACTION = re.compile(r"Action:\s*(\w+)\((\{.*\})\)\s*$", re.MULTILINE | re.DOTALL)


def _problems(payload: dict) -> list:
    found = []
    unknown = sorted(set(payload) - {"amount_cents", "order_id"})
    if unknown:
        found.append(
            f"the refund tool takes no {', '.join(unknown)} argument"
        )
    for name in ("amount_cents", "order_id"):
        if name not in payload:
            found.append(f"{name} is missing")

    amount = payload.get("amount_cents")
    if "amount_cents" in payload and type(amount) is not int:
        found.append(
            f"amount_cents must be an integer between {MIN_CENTS} and {MAX_CENTS}, "
            f"and {json.dumps(amount)} is not one"
        )
    elif type(amount) is int and not (MIN_CENTS <= amount <= MAX_CENTS):
        found.append(
            f"amount_cents must be between {MIN_CENTS} and {MAX_CENTS}, and {amount} is not"
        )

    order = payload.get("order_id")
    if "order_id" in payload and (not isinstance(order, str) or not order.strip()):
        found.append("order_id must be a non-empty string")

    return found


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Request: {question}\n"

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

        try:
            payload = json.loads(action.group(2))
        except ValueError as exc:
            scratchpad += f"{output}\nThe payload was not JSON: {exc}\n"
            continue

        if not isinstance(payload, dict):
            scratchpad += f"{output}\nThe payload was not a JSON object.\n"
            continue

        broken = _problems(payload)
        if broken:
            scratchpad += f"{output}\nI did not call refund: {'; '.join(broken)}.\n"
            continue

        result = tools["refund"](**payload)
        scratchpad += f"{output}\n<observation>{json.dumps(result)}</observation>\n"

    return "I could not process this refund."

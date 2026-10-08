"""Reference solution for describe-tools-so-the-model-picks-right.

All three tools give a customer money back, so their names cannot separate
them, and with a line each the model chose by name. Each description now
carries the facts the choice turns on: the order state in which the tool is
right, in the order system's own words; the tool to use instead when it is
wrong, by its exact name; and when the money moves.

The tool list goes at the top of the first prompt and stays there as the
scratchpad grows, so the model reads the same descriptions when it chooses a
tool and when it answers the customer.
"""

import json
import re

DESCRIPTIONS = {
    "cancel_order": (
        "Cancels the whole order and refunds it in full at once. Use it only while "
        "the order is placed and not yet dispatched. A dispatched or delivered order "
        "cannot be cancelled: once it is delivered, use start_return instead."
    ),
    "start_return": (
        "Books a courier to collect an item the customer has from a delivered order, "
        "and returns the return id and the pickup day. The refund is paid when the "
        "item reaches the warehouse, 3 to 5 days later, not when the pickup is "
        "booked. If the item never arrived, use refund_item instead."
    ),
    "refund_item": (
        "Refunds one item at once and collects nothing. Use it only when an item is "
        "missing from a delivered order. If the customer has the item, use "
        "start_return instead."
    ),
}

MAX_CALLS = 3
ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)


def arguments(raw: str) -> dict:
    """Turn 'order_id=OD-1, item=kettle' into {'order_id': 'OD-1', 'item': 'kettle'}."""
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def tool_lines() -> str:
    """The tool list as the model reads it: one line per tool, '<name>: <description>'."""
    return "\n".join(f"{name}: {text}" for name, text in DESCRIPTIONS.items())


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Tools:\n{tool_lines()}\n\nRequest: {question}\n"

    for _ in range(MAX_CALLS):
        reply = llm(scratchpad)
        if "Final Answer:" in reply:
            return reply.split("Final Answer:", 1)[1].strip()

        action = ACTION.search(reply)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{reply}\nThat was not a tool you have.\n"
            continue

        result = tools[action.group(1)](**arguments(action.group(2)))
        scratchpad += f"{reply}\nObservation: {json.dumps(result)}\n"

    return "I could not finish this request."

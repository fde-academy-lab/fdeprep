"""Reference solution for decide-where-a-person-sits-for-each-action.

Whether an action can be undone decides first, and its cost decides only
after that. On the loop means a person sees the action after it runs and can
reverse it, so that placement is open only to an action that can be reversed.
An action that cannot be undone, and one whose tool the policy has never
classified, waits for a person's approval whatever it costs. Only then does a
reversible action meet the two cost lines.

The policy is read on every run, because the operations team moves its lines
without a release.
"""

import json

IN, ON, OUT = "in", "on", "out"


def place(action: dict, policy: dict) -> str:
    """Where a person sits for this action: IN, ON or OUT."""
    table = policy.get("reversible") or {}
    tool = action.get("tool")
    if tool not in table or table[tool] is not True:
        return IN

    cost = action.get("cost")
    if isinstance(cost, bool) or not isinstance(cost, (int, float)):
        return IN
    if cost > policy["approve_above"]:
        return IN
    if cost > policy["watch_above"]:
        return ON
    return OUT


def run_agent(question: str, llm, tools: dict) -> str:
    policy = tools["policy"]()
    actions = tools["proposals"]()["actions"]
    placed = {}

    for action in actions:
        mode = place(action, policy)
        placed[action["id"]] = mode
        if mode == IN:
            tools["ask_approval"](action=action["id"])
            continue
        tools[action["tool"]](**action["args"])
        if mode == ON:
            tools["notify"](action=action["id"])

    return json.dumps(placed)

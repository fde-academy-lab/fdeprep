"""Reference solution for check-the-policy-before-the-action-runs.

Every proposed action goes through one function that reads the policy
document and the session's role, and answers either nothing (allowed) or the
reason it is refused. Nothing is called until that function has answered.

The function defaults to no. An action the role does not list is refused, and
so is a limit whose argument is missing or is not a number, because a check
that cannot read the amount has not checked it.

A refusal goes into the scratchpad as a line starting "Refused:", naming the
action and the limit, so the model can tell the customer what happens next and
the log shows which rule said no.
"""

import json
import re

_ACTION = re.compile(r"Action:\s*(\{.*\})\s*$", re.DOTALL)


def _refusal(role, roles: dict, tool: str, args: dict):
    """None when the policy allows the action, otherwise the reason it does not."""
    entry = roles.get(role)
    if not isinstance(entry, dict) or tool not in entry:
        return f"the {role} role may not use {tool}"

    limits = (entry.get(tool) or {}).get("max") or {}
    for name, limit in limits.items():
        value = args.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return (f"{tool} has no numeric {name} to check against the {role} "
                    f"limit of {limit}")
        if value > limit:
            return f"{tool} of {value} is above the {role} limit of {limit}"
    return None


def _parse(output: str):
    found = _ACTION.search(output)
    if found is None:
        return None
    try:
        action = json.loads(found.group(1))
    except ValueError:
        return None
    if not isinstance(action, dict) or not isinstance(action.get("args", {}), dict):
        return None
    return action


def run_agent(question: str, llm, tools: dict) -> str:
    role = (tools["session"]() or {}).get("role")
    roles = (tools["policy"]() or {}).get("roles") or {}
    scratchpad = f"Customer: {question}\n"

    for _ in range(3):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()

        action = _parse(output)
        if action is None:
            scratchpad += f"{output}\nThat action could not be read.\n"
            continue

        tool = str(action.get("tool"))
        args = action.get("args") or {}
        reason = _refusal(role, roles, tool, args)
        if reason is None and tool not in tools:
            reason = f"there is no {tool} tool"
        if reason is not None:
            scratchpad += f"{output}\nRefused: {reason}.\n"
            continue

        result = tools[tool](**args)
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return "I could not finish this in the chat, so a supervisor will pick it up."

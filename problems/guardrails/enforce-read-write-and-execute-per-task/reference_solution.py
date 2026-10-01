"""Reference solution for enforce-read-write-and-execute-per-task.

Read, write and execute are three separate permissions, and a task holds
only the ones its own record grants. An execute grant counts only when a
person other than the requester approved it: execute is the permission that
can do anything, and a requester approving their own execute is nobody
approving it. User names compare without regard to case, as the directory
treats them.

A tool runs when the task holds every permission the registry lists for it.
Every default fails closed: a registry that did not arrive lists no tool, and
a tool the registry does not list never runs, whatever the task holds.

The check runs before every call. A refusal names only the permissions the
task is missing, so the model can choose another way or explain what the
engineer has to ask for, and the same list goes in the report.
"""

import json
import re

PERMISSIONS = ("read", "write", "execute")
ACTION = re.compile(r"Action:\s*(\{.*\})\s*$", re.DOTALL)
MAX_CALLS = 4


def held_permissions(task) -> set:
    """The permissions this task validly holds, read from its record alone."""
    if not isinstance(task, dict):
        return set()
    requester = task.get("requested_by")
    requester = requester.strip().lower() if isinstance(requester, str) else ""
    held = set()
    for grant in task.get("grants") or []:
        if not isinstance(grant, dict) or grant.get("permission") not in PERMISSIONS:
            continue
        if grant["permission"] == "execute":
            approver = grant.get("approved_by")
            approver = approver.strip().lower() if isinstance(approver, str) else ""
            if not approver or not requester or approver == requester:
                continue
        held.add(grant["permission"])
    return held


def missing_for(tool, registry: dict, held: set) -> list:
    """What the task lacks to run this tool, in read, write, execute order."""
    needed = registry.get(tool) if isinstance(tool, str) else None
    if (not isinstance(needed, list) or not needed
            or not all(permission in PERMISSIONS for permission in needed)):
        return ["unregistered"]
    return [permission for permission in PERMISSIONS
            if permission in needed and permission not in held]


def read_action(output: str):
    found = ACTION.search(output)
    if found is None:
        return None
    try:
        action = json.loads(found.group(1))
    except ValueError:
        return None
    if not isinstance(action, dict) or not isinstance(action.get("args") or {}, dict):
        return None
    return action


def run_agent(question: str, llm, tools: dict) -> str:
    held = held_permissions(tools["task"]())
    answer = tools["registry"]()
    registry = answer.get("tools") if isinstance(answer, dict) else None
    if not isinstance(registry, dict):
        registry = {}

    scratchpad = (
        f"Request: {question}\n"
        f"This task holds: {', '.join(p for p in PERMISSIONS if p in held) or 'nothing'}\n"
    )
    called, refused = [], []

    for _ in range(MAX_CALLS):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            final = output.split("Final Answer:", 1)[1].strip()
            return json.dumps({"answer": final, "called": called, "refused": refused})

        action = read_action(output)
        if action is None:
            scratchpad += f"{output}\nThat action could not be read. Reply with one Action.\n"
            continue

        tool = action.get("tool")
        missing = missing_for(tool, registry, held)
        if missing:
            refused.append({"tool": str(tool), "missing": missing})
            scratchpad += f"{output}\nRefused: {tool} is missing {', '.join(missing)}.\n"
            continue

        result = tools[tool](**(action.get("args") or {}))
        called.append(tool)
        scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return json.dumps({"answer": None, "called": called, "refused": refused})

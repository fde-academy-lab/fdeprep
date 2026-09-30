"""Reference solution for fall-back-only-when-the-policy-permits.

The fallback is a privilege escalation, and it is only safe when the reason for
it is that the normal path is down. So the policy is an allowlist of one
failure class: a 503, or a call that raised. A 401 or 403 is the normal path
working, and a 404 from a customer-scoped API may be a refusal that does not
want to say so, so neither ever reaches the stronger tool.

The second condition is the action. staff_console skips the identity check that
account_api enforces, so it may only take the actions the security team listed
for it, and a SIM swap is not one of them whatever the outage.
"""

import json
import re

FALLBACK_ALLOWED = {"usage"}

_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)


def _result(outcome: str, via) -> str:
    return json.dumps({"outcome": outcome, "via": via})


def _arguments(raw: str) -> dict:
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def _classify(tool, action: str, args: dict) -> str:
    try:
        reply = tool(action=action, **args)
    except Exception:
        return "unavailable"

    status = reply.get("status") if isinstance(reply, dict) else None
    if status == 200:
        return "done"
    if status == 503:
        return "unavailable"
    if status in (401, 403):
        return "denied"
    return "failed"


def run_agent(question: str, llm, tools: dict) -> str:
    output = llm(f"Request: {question}\n")
    found = _ACTION.search(output)
    if found is None:
        return _result("failed", None)

    action, args = found.group(1), _arguments(found.group(2))

    first = _classify(tools["account_api"], action, args)
    if first == "done":
        return _result("done", "account_api")
    if first != "unavailable" or action not in FALLBACK_ALLOWED:
        return _result(first, None)

    if _classify(tools["staff_console"], action, args) == "done":
        return _result("done", "staff_console")
    return _result("unavailable", None)

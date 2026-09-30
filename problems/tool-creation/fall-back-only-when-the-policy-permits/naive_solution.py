"""What an unprepared learner writes in four minutes.

If account_api does not answer with a 200, it tries staff_console. That is the
rule the incident ran on. It reads a refusal as an outage, it hands a SIM swap
to a tool that skips the identity check, and a call that raises never reaches
the fallback at all, because nothing catches it.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    output = llm(f"Request: {question}\n")
    found = re.search(r"Action:\s*(\w+)\((.*?)\)\s*$", output, re.MULTILINE)
    if found is None:
        return json.dumps({"outcome": "failed", "via": None})

    action = found.group(1)
    args = {}
    for pair in found.group(2).split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()

    reply = tools["account_api"](action=action, **args) or {}
    if reply.get("status") == 200:
        return json.dumps({"outcome": "done", "via": "account_api"})

    reply = tools["staff_console"](action=action, **args) or {}
    if reply.get("status") == 200:
        return json.dumps({"outcome": "done", "via": "staff_console"})
    return json.dumps({"outcome": "unavailable", "via": None})

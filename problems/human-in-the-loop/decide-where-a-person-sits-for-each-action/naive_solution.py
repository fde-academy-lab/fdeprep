"""What an unprepared learner writes in four minutes.

It places every action by what it costs, which is the rule the agent ran on
before the notice went out: cheap runs on its own, mid-range runs with the
duty manager told, expensive waits for approval. It reads the policy's two
lines and nothing else in the policy, so a notice that costs nothing runs
with nobody watching, and a deposit nobody can claw back runs before anyone
has looked at it.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    policy = tools["policy"]()
    actions = tools["proposals"]()["actions"]
    placed = {}

    for action in actions:
        cost = action["cost"]
        if cost > policy["approve_above"]:
            mode = "in"
        elif cost > policy["watch_above"]:
            mode = "on"
        else:
            mode = "out"
        placed[action["id"]] = mode

        if mode == "in":
            tools["ask_approval"](action=action["id"])
            continue
        tools[action["tool"]](**action["args"])
        if mode == "on":
            tools["notify"](action=action["id"])

    return json.dumps(placed)

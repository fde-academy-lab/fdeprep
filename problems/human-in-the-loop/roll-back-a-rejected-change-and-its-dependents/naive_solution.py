"""What an unprepared learner writes in four minutes.

It runs every reversible change at once and asks the approver about the rest
as they arrive, which is the half of the policy everyone gets right. Then it
treats a rejection the way a database treats a failed transaction: it undoes
the rejected change and everything the run did after it. A reprice of an
unrelated item that happened to come later goes back with the bundle, and an
email built on a price nobody has reviewed yet goes out the moment the
approver clicks.
"""

import json
import re

UNDO = {
    "set_price": "restore_price",
    "create_bundle": "delete_bundle",
    "schedule_banner": "cancel_banner",
}


def run_agent(question: str, llm, tools: dict) -> str:
    actions = {}
    ran = []
    refused = []

    for _ in range(12):
        reply = llm(f"Night run {question}. Propose the next action, or reply Done.").strip()
        if not reply.startswith("Action:"):
            break
        action = json.loads(reply[len("Action:"):])
        actions[action["id"]] = action
        if action["tool"] in UNDO:
            tools[action["tool"]](**action["args"])
            ran.append(action["id"])
        elif tools["approve"](action_id=action["id"]).get("approved"):
            tools[action["tool"]](**action["args"])
        else:
            refused.append(action["id"])

    decisions = tools["reviews"](run=question)["decisions"]
    undone = []
    rejected = [action_id for action_id in ran if decisions.get(action_id) == "rejected"]
    if rejected:
        first = ran.index(rejected[0])
        for action_id in reversed(ran[first:]):
            tools[UNDO[actions[action_id]["tool"]]](action_id=action_id)
            undone.append(action_id)

    return json.dumps({"undone": undone, "stuck": [], "held": [],
                       "refused": refused, "cancelled": []})

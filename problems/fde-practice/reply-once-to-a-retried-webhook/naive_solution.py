"""What an unprepared learner writes in four minutes.

It fixes the key, which the brief all but names, and widens the duplicate
check to skip an event that is in progress as well as one that is done. The
check is still a lookup followed by a write twelve seconds later, so two
deliveries that look at the same moment both read absent and both reply.

It also acknowledges everything with 200. That tells the help desk to stop
retrying an event another delivery has not finished yet, and a reply that
failed to post is marked done and acknowledged as if it had gone out.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    delivery = json.loads(question)
    ticket = delivery["ticket"]

    key = delivery["event_id"]

    state = tools["lookup"](key=key).get("state")
    if state in ("done", "in_progress"):
        return json.dumps({"http_status": 200, "note": "already handled"})

    reply = llm(f"Write a first reply to this ticket: {ticket['subject']}")
    tools["post_reply"](ticket=ticket["id"], body=reply.replace("Reply:", "", 1).strip())

    tools["mark_done"](key=key)
    return json.dumps({"http_status": 200, "note": "replied"})

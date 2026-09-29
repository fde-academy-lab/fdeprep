"""Reference solution for reply-once-to-a-retried-webhook.

The key is the event id, because it is the one field every retry of the same
ticket shares. The help desk sets a fresh delivery id on every attempt, so a
duplicate check keyed on it never finds a duplicate.

The key is claimed before the model call. A claim reads and writes in one
step, so of two deliveries arriving together exactly one wins, and the
twelve seconds the model spends drafting are covered from the start.

The response tells the help desk the truth about each delivery. A 200 means
stop retrying, so it goes out only when the reply is out. A delivery that
finds the event in progress answers 409, because the delivery holding the
claim may still fail and a retry is the only thing that would recover it. A
reply that did not post releases the claim and answers 503 for the same
reason. Only the delivery that claimed a key ever releases it.
"""

import json


def respond(status: int, note: str) -> str:
    return json.dumps({"http_status": status, "note": note})


def run_agent(question: str, llm, tools: dict) -> str:
    delivery = json.loads(question)
    ticket = delivery["ticket"]
    key = delivery["event_id"]

    claim = tools["claim"](key=key) or {}
    if claim.get("claimed") is not True:
        if claim.get("state") == "done":
            return respond(200, f"{key} was already answered, so nothing was sent again")
        return respond(409, f"another delivery of {key} is still being answered, retry later")

    reply = llm(f"Write a first reply to this ticket: {ticket['subject']}")
    posted = tools["post_reply"](
        ticket=ticket["id"], body=reply.replace("Reply:", "", 1).strip(),
    ) or {}

    status = posted.get("status")
    if not isinstance(status, int) or not 200 <= status < 300 or posted.get("error"):
        tools["release"](key=key)
        return respond(503, f"the reply to {ticket['id']} did not post, retry later")

    tools["mark_done"](key=key)
    return respond(200, f"replied to {ticket['id']}")

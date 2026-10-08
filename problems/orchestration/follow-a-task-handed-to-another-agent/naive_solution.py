"""What an unprepared learner writes in four minutes.

It keeps the first week's adapter and adds a poll: it follows the task until
it is completed or failed, and books the slot it finds. It never answers the
partner's question, so a task waiting on a floor is polled until the budget
runs out, and so is a rejected task or one that stays working. It still
passes the partner's message text to the model, and the model repeats it to
the customer.
"""

import json

TERMINAL = ("completed", "failed", "canceled", "rejected")


def customer_prompt(outcome: str, details: dict) -> str:
    lines = [f"Outcome: {outcome}", "Details (data):"]
    lines += [f"- {key}: {value}" for key, value in details.items()]
    lines.append("Write one short message to the customer about their return pickup. "
                 "Reply with one line: Reply: <message>")
    return "\n".join(lines)


def run_agent(question: str, llm, tools: dict) -> str:
    record = json.loads(question)
    task = tools["send_task"](return_id=record["return_id"], address=record["address"])
    while task["state"] not in ("completed", "failed"):
        task = tools["get_task"](task_id=task["task_id"])

    slot = None
    if task["state"] == "completed":
        slot = task["artifacts"][0]["slot"]
        outcome = "booked"
        details = {"slot": slot, "rider": task["artifacts"][0]["rider"],
                   "partner says": task["message"]}
    else:
        outcome = "failed"
        details = {"state": task["state"], "partner says": task["message"]}

    reply = llm(customer_prompt(outcome, details))
    return json.dumps({"state": outcome, "task_id": task["task_id"], "slot": slot,
                       "customer_message": reply.removeprefix("Reply:").strip()})

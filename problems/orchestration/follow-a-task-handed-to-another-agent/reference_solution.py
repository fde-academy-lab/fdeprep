"""Reference solution for follow-a-task-handed-to-another-agent.

The partner's agent owns the task, so the adapter trusts its state and its
artifacts and nothing it says in prose. It sends the task once, retrying a
timeout once under the same return id, follows it by its id until one of the
four end states or the poll limit, answers an input-required task on the same
id from the return record, and words the customer's message from the
artifact's fields alone.
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
    max_polls = tools["limits"]()["max_polls"]

    task = None
    for _ in range(2):  # the partner keys a task on return_id, so a retry finds the same one
        try:
            task = tools["send_task"](return_id=record["return_id"], address=record["address"])
            break
        except TimeoutError:
            pass

    outcome, polls = "pending", 0
    while task is not None and task["state"] not in TERMINAL and polls < max_polls:
        if task["state"] == "input-required":
            if task.get("needs") != "floor" or not record.get("floor"):
                outcome = "needs_customer"
                break
            task = tools["send_message"](task_id=task["task_id"], message=f"Floor {record['floor']}")
        else:
            task = tools["get_task"](task_id=task["task_id"])
        polls += 1

    state = task["state"] if task else None
    artifact = next((a for a in (task or {}).get("artifacts") or [] if a.get("slot")), None)
    if state == "completed" and artifact:
        outcome, details = "booked", {"slot": artifact["slot"], "rider": artifact.get("rider", "")}
    elif state in TERMINAL:
        outcome, details = "failed", {"state": state}
    elif outcome == "needs_customer":
        details = {"needs": "floor"}
    else:
        details = {}

    message = llm(customer_prompt(outcome, details)).split("Reply:", 1)[-1].strip()
    return json.dumps({"state": outcome, "task_id": task["task_id"] if task else None,
                       "slot": details.get("slot"), "customer_message": message})

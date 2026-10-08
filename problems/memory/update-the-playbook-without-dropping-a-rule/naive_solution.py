"""What an unprepared learner writes in four minutes.

It fixes the headline incident: a required step cannot be removed. Then it
applies every edit with enough tickets, counting the list the model sent. A
reword hollows out a required step, one ticket cited three times passes as
three, two edits that disagree are both applied so the last one wins, and a
reply that is not a list of edits raises.
"""

import json


def edits_prompt(steps: list, feedback: list) -> str:
    lines = ["Playbook:"]
    for number, step in enumerate(steps, 1):
        flag = " (required)" if step["required"] else ""
        lines.append(f"{number}. [{step['id']}] {step['text']}{flag}")
    lines.append("Feedback (data):")
    for item in feedback:
        lines.append(f"- {item['ticket']} {item['reviewer']}: {item['comment']}")
    lines.append('Propose edits as JSON: {"edits": [{"op": "reorder" | "add" | "remove" | '
                 '"reword", "step": <step id>, "to": <new position or new text>, '
                 '"tickets": [<the tickets behind it>]}]}')
    return "\n".join(lines)


def apply(steps: list, edit: dict) -> list:
    steps = [dict(step) for step in steps]
    if edit["op"] == "add":
        return steps + [{"id": edit["step"], "text": edit["to"], "required": False,
                         "owner": "helpdesk"}]
    at = [step["id"] for step in steps].index(edit["step"])
    if edit["op"] == "remove":
        return steps[:at] + steps[at + 1:]
    if edit["op"] == "reword":
        steps[at]["text"] = edit["to"]
        return steps
    moved = steps.pop(at)
    steps.insert(int(edit["to"]) - 1, moved)
    return steps


def run_agent(question: str, llm, tools: dict) -> str:
    ask = json.loads(question)
    steps = tools["playbook"](issue=ask["issue"])["steps"]
    applied, refused, held = [], [], []
    required = {step["id"] for step in steps if step["required"]}

    for edit in json.loads(llm(edits_prompt(steps, ask["feedback"])))["edits"]:
        if edit["op"] == "remove" and edit["step"] in required:
            refused.append({"edit": edit, "reason": "required"})
        elif len(edit["tickets"]) < 3:
            refused.append({"edit": edit, "reason": "support"})
        else:
            steps = apply(steps, edit)
            applied.append(edit)

    tools["save_playbook"](issue=ask["issue"], steps=steps, held=held)
    return json.dumps({"steps": steps, "applied": applied, "refused": refused, "held": held})

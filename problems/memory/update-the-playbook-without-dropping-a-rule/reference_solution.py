"""Reference solution for update-the-playbook-without-dropping-a-rule.

The playbook is procedural memory, so the model never writes it. It proposes
edits, and each one is checked before the playbook takes it: a required step
is never removed or reworded, an edit needs three different tickets from this
week's feedback, counted by the code, and edits that disagree about one step
go to a person. A reply that is not a list of edits changes nothing.
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

    try:
        edits = json.loads(llm(edits_prompt(steps, ask["feedback"])))["edits"]
    except (ValueError, KeyError, TypeError):
        edits = []  # prose, or a whole playbook: the reply proposes no edit
    if not isinstance(edits, list):
        edits = []

    tickets = {item["ticket"] for item in ask["feedback"]}
    required = {step["id"] for step in steps if step["required"]}
    passed = []
    for edit in edits:
        if edit["op"] in ("remove", "reword") and edit["step"] in required:
            refused.append({"edit": edit, "reason": "required"})
        elif len(set(edit.get("tickets") or []) & tickets) < 3:
            refused.append({"edit": edit, "reason": "support"})
        else:
            passed.append(edit)

    for edit in passed:
        rivals = [other for other in passed if other["step"] == edit["step"]
                  and (other["op"], other.get("to")) != (edit["op"], edit.get("to"))]
        if rivals:
            held.append(edit)
        else:
            steps = apply(steps, edit)
            applied.append(edit)

    tools["save_playbook"](issue=ask["issue"], steps=steps, held=held)
    return json.dumps({"steps": steps, "applied": applied, "refused": refused, "held": held})

"""What an unprepared learner writes in four minutes.

It gives the agent the intent lines, parses the questions that come back and
looks every one up in discovery: a number is an answer and anything else goes
to the sponsor. It never reads what each question cites, so a question about
installations that cites an intent line nobody wrote, and a question that cites
nothing at all, both land on the sponsor's list.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    lines = tools["intent"]()
    reply = llm("Propose discovery questions as JSON for this intent:\n" + json.dumps(lines))
    questions = json.loads(reply)["questions"]

    answered, ask_sponsor = [], []
    for q in questions:
        value = tools["discovery"](metric=q["metric"])
        if value is None:
            ask_sponsor.append(q["id"])
        else:
            answered.append({"id": q["id"], "answer": value})

    return json.dumps({"answered": answered, "ask_sponsor": ask_sponsor, "dropped": []})

"""Reference solution for fund-the-agent-1-sort-the-elaboration-questions.

Every question cites the intent it serves, and the citation is the agent's
claim about its own work. A question goes forward only when it cites at least
one id and every id it cites is a line intent() returns. An empty list, a line
nobody wrote and the sponsor's own opening sentence all fail that one lookup.

The data lead's read is null when nobody has measured the metric, so that
question goes to the sponsor. Any number is an answer, 0 included, which is why
the read is compared with None instead of being tested for truth.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    intent = {line["id"]: line["text"] for line in tools["intent"]()}
    lines = "\n".join(f"{line_id}: {text}" for line_id, text in intent.items())
    reply = llm(
        "Propose the discovery questions for the agreed intent below. Reply with one JSON "
        'object, {"questions": [...]}, giving each question an id, its text, the intent ids '
        "it traces_to and the metric that would answer it, or null.\n"
        f"<intent>\n{lines}\n</intent>"
    )

    answered, ask_sponsor, dropped = [], [], []
    for q in json.loads(reply)["questions"]:
        cited = q.get("traces_to") or []
        stray = next((i for i in cited if i not in intent), None)
        if stray or not cited:
            reason = f"{stray} is not an intent line" if stray else "traces to nothing"
            dropped.append({"id": q["id"], "reason": reason})
            continue
        value = tools["discovery"](metric=q["metric"]) if q.get("metric") else None
        if value is None:
            ask_sponsor.append(q["id"])
        else:
            answered.append({"id": q["id"], "answer": value})

    return json.dumps({"answered": answered, "ask_sponsor": ask_sponsor, "dropped": dropped})

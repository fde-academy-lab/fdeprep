"""What an unprepared learner writes in four minutes.

It applies the bar correctly to an ordinary reply, and it escalates with the
two facts it happens to be holding: the applicant id and the score. The
reviewer gets a number and has to fetch the application and the document
again, which may by then be a newer upload than the one the agent judged. A
reply with no confidence counts as 0 and goes out labelled as below the bar,
and any label at all is recorded when the number is high enough.
"""

import json
import re

BAR = 0.85


def read_decision(reply: str):
    match = re.search(r"Decision:\s*(\{.*\})", reply, re.DOTALL)
    if not match:
        return None
    try:
        decision = json.loads(match.group(1))
    except ValueError:
        return None
    return decision if isinstance(decision, dict) else None


def run_agent(question: str, llm, tools: dict) -> str:
    application = tools["application"](applicant=question)
    document = tools["document"](applicant=question)
    reply = llm(
        f"Application: {json.dumps(application)}\n"
        f"Document: {json.dumps(document)}\n"
        "Reply with Decision: {\"decision\": ..., \"confidence\": ..., \"because\": ...}\n"
    )
    decision = read_decision(reply) or {}
    confidence = decision.get("confidence", 0)

    if confidence >= BAR:
        tools["record"](applicant=question, decision=decision.get("decision"))
        return json.dumps({"outcome": "recorded", "decision": decision.get("decision")})

    tools["escalate"](applicant=question, confidence=confidence, reason="below_bar")
    return json.dumps({"outcome": "escalated", "reason": "below_bar"})

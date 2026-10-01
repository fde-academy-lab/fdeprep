"""Reference solution for escalate-with-the-evidence-a-reviewer-needs.

The run gathers its evidence once and asks the model once. A reply is used
only when it holds one of the two decisions and a confidence that is a number
from 0 to 1 at or above the bar. Anything else goes to a person, and the
escalation carries everything the reviewer needs to decide without running
anything again: what the model proposed, how sure it said it was, why the
case came to a person, the model's own reason, and both results exactly as
the run received them.

A second model call is never made. Asking again until the number clears the
bar would turn the bar into a retry count.
"""

import json
import re

BAR = 0.85
DECISIONS = ("verify", "reject")


def read_decision(reply: str):
    """The object in a "Decision: {...}" reply, or None when there is none."""
    match = re.search(r"Decision:\s*(\{.*\})", reply, re.DOTALL)
    if not match:
        return None
    try:
        decision = json.loads(match.group(1))
    except ValueError:
        return None
    return decision if isinstance(decision, dict) else None


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def run_agent(question: str, llm, tools: dict) -> str:
    application = tools["application"](applicant=question)
    document = tools["document"](applicant=question)
    reply = llm(
        "Check this identity document against the application.\n"
        f"<application>{json.dumps(application)}</application>\n"
        f"<document>{json.dumps(document)}</document>\n"
        'Reply with Decision: {"decision": "verify" or "reject", '
        '"confidence": 0 to 1, "because": one sentence}\n'
    )

    decision = read_decision(reply)
    proposed = confidence = because = None
    if decision is None:
        reason = "unreadable"
    else:
        proposed = decision.get("decision")
        because = decision.get("because") if isinstance(decision.get("because"), str) else None
        raw = decision.get("confidence")
        confidence = raw if is_number(raw) else None
        if proposed not in DECISIONS:
            reason = "unknown_decision"
        elif confidence is None or not 0 <= confidence <= 1:
            reason = "no_confidence"
        elif confidence < BAR:
            reason = "below_bar"
        else:
            reason = None

    if reason is None:
        tools["record"](applicant=question, decision=proposed)
        return json.dumps({"outcome": "recorded", "decision": proposed})

    tools["escalate"](
        applicant=question,
        proposed=proposed,
        confidence=confidence,
        reason=reason,
        because=because,
        evidence=[application, document],
    )
    return json.dumps({"outcome": "escalated", "reason": reason})

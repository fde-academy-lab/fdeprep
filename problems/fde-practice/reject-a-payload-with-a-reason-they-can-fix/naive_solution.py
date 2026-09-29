"""What an unprepared learner writes in four minutes.

It checks that every required key is present, and reaches for the defensive
idiom when it looks inside the tenant. Both checks are about keys. A key that
is present with null passes the first, and `.get("tenant", {})` hands back
None rather than the empty dict, so the second raises. A priority the
contract never listed passes both and goes straight to the queue.
"""

import json

PRIORITIES = ("low", "normal", "urgent")
REQUIRED = ("request_id", "priority", "tenant", "description")


def is_text(value) -> bool:
    """True for a string with something in it."""
    return isinstance(value, str) and value.strip() != ""


def contract_problems(request: dict) -> list:
    """Every way this request breaks the contract, each as {"field", "problem"}."""
    problems = []

    for name in REQUIRED:
        if name not in request:
            problems.append({"field": name, "problem": "missing"})

    tenant = request.get("tenant", {})
    if "unit" not in tenant:
        problems.append({"field": "tenant.unit", "problem": "missing"})

    return problems


def run_agent(question: str, llm, tools: dict) -> str:
    request = json.loads(question)

    problems = contract_problems(request)
    if problems:
        return json.dumps({"accepted": False, "errors": problems})

    reply = llm(f"Summarise this repair request in one line: {request['description']}")
    case = tools["create_case"](
        request_id=request["request_id"],
        priority=request["priority"],
        unit=request["tenant"]["unit"],
        summary=reply.replace("Summary:", "").strip(),
    )
    return json.dumps({"accepted": True, "case_id": case["case_id"]})

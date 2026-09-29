"""Reference solution for reject-a-payload-with-a-reason-they-can-fix.

The contract is checked in full before anything spends. A request that breaks
it never reaches the model and never becomes a case, because the model will
summarise anything it is handed and the queue will file anything it is given.

Every problem is collected before the reply goes back. The engineer on the
other side fixes what they are told and redeploys, so a rejection that names
one problem at a time costs them one deploy per field.

Each problem names the full path, what the contract expects and what arrived,
written in the customer's own notation. The tenant check asks what kind of
value arrived before it reads inside it, because a key that is present with
null is exactly the case a default on `.get()` does not cover.
"""

import json

PRIORITIES = ("low", "normal", "urgent")


def is_text(value) -> bool:
    """True for a string with something in it."""
    return isinstance(value, str) and value.strip() != ""


def arrived(container: dict, key: str) -> str:
    """What the customer sent for this key, as they would see it in their logs."""
    if key not in container:
        return "and the field is missing"
    return "got " + json.dumps(container[key])


def contract_problems(request: dict) -> list:
    """Every way this request breaks the contract, each as {"field", "problem"}."""
    problems = []

    for name in ("request_id", "description"):
        if not is_text(request.get(name)):
            problems.append({
                "field": name,
                "problem": f"expected a non-empty string, {arrived(request, name)}",
            })

    if request.get("priority") not in PRIORITIES:
        problems.append({
            "field": "priority",
            "problem": f"expected one of {', '.join(PRIORITIES)}, "
                       f"{arrived(request, 'priority')}",
        })

    tenant = request.get("tenant")
    if not isinstance(tenant, dict):
        problems.append({
            "field": "tenant",
            "problem": f"expected an object with name and unit, {arrived(request, 'tenant')}",
        })
    else:
        for name in ("name", "unit"):
            if not is_text(tenant.get(name)):
                problems.append({
                    "field": f"tenant.{name}",
                    "problem": f"expected a non-empty string, {arrived(tenant, name)}",
                })

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
        summary=reply.replace("Summary:", "", 1).strip(),
    )
    return json.dumps({"accepted": True, "case_id": case["case_id"]})

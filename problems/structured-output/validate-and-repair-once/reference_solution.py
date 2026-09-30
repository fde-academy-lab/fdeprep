"""Reference solution for validate-and-repair-once.

Parsing proves the reply is JSON. validate() proves the warehouse can use it:
exactly the three keys, a decision it knows, a whole number of pence, and a
reason. Every reply goes through the same check, the repair included.

One repair is sent, carrying every problem on its own line with the key first,
so the second call asks a different question from the first. A second invalid
reply ends in needs_review with the problems attached. Nothing is converted on
this side: a wrong type goes back to the model, because it may be hiding a
wrong value.
"""

import json

DECISIONS = ("refund", "replace", "reject")
KEYS = ("decision", "amount_pence", "reason")
REPAIRS_ALLOWED = 1


def build_prompt(request: str) -> str:
    return (
        "Decide this return request. Reply with one JSON object and nothing "
        "else, with exactly these keys:\n"
        '  "decision": "refund", "replace" or "reject"\n'
        '  "amount_pence": whole pence, 0 or more\n'
        '  "reason": one sentence for the customer\n\n'
        f"Request: {request}\n"
    )


def validate(record) -> list:
    """Every problem with one parsed reply, one line each, key first."""
    if not isinstance(record, dict):
        return ["the reply must be one JSON object"]

    problems = [f"{key} is missing" for key in KEYS if key not in record]
    problems += [f"{key} is not a key this record takes" for key in record if key not in KEYS]

    if "decision" in record and record["decision"] not in DECISIONS:
        problems.append(f"decision must be one of {', '.join(DECISIONS)}")
    if "amount_pence" in record:
        amount = record["amount_pence"]
        if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0:
            problems.append("amount_pence must be a whole number of pence, 0 or more")
    if "reason" in record:
        reason = record["reason"]
        if not isinstance(reason, str) or not reason.strip():
            problems.append("reason must be a sentence with text in it")
    return problems


def parse(reply: str):
    """The parsed reply and its problems. Text that is not JSON is one problem."""
    try:
        record = json.loads(reply)
    except ValueError:
        return None, ["the reply must be one JSON object and it did not parse"]
    return record, validate(record)


def repair_prompt(request: str, reply: str, problems: list) -> str:
    listed = "\n".join(problems)
    return (
        f"{build_prompt(request)}\n"
        f"Your reply was:\n{reply}\n\n"
        f"It had these problems:\n{listed}\n\n"
        "Reply again with one JSON object that fixes every one of them.\n"
    )


def run_agent(question: str, llm, tools: dict) -> str:
    prompt = build_prompt(question)
    problems = []

    for _ in range(1 + REPAIRS_ALLOWED):
        reply = llm(prompt)
        record, problems = parse(reply)
        if not problems:
            return json.dumps({"status": "ok", "record": record})
        prompt = repair_prompt(question, reply, problems)

    return json.dumps({"status": "needs_review", "record": None, "errors": problems})

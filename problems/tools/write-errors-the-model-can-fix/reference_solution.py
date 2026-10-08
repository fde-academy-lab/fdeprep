"""Reference solution for write-errors-the-model-can-fix.

The model can change only what it can see is wrong. So every error it reads
names the field, shows the value exactly as the model sent it, and says what
the field accepts, and it names every problem at once, because the budget
allows one correction and the model fixes only what it hears about.

The checks run here, against the API's own table, before anything reaches the
payments service, which stops at the first bad field and names it with a code
the model has never seen. The service's own answers are translated too: one
carries a lower limit for this order, which becomes an ordinary problem with
that limit, and two mean that no corrected call will help, which the error
says with "retryable": false, so the model answers the customer instead of
trying again.
"""

import json
import re

FIELDS = ("order_id", "amount_paise", "reason")
REASONS = ["damaged", "missing", "wrong_item", "late"]
MAX_PAISE = 50000
ORDER_ID = re.compile(r"^OD-\d+$")
ACTION = re.compile(r"^Action:\s*refund\((\{.*\})\)\s*$", re.MULTILINE | re.DOTALL)
FINAL = re.compile(r"^Final Answer:\s*(.*)$", re.MULTILINE | re.DOTALL)
MAX_CALLS = 3


def amount_rule(limit) -> str:
    return f"a whole number from 1 to {limit}"


ALLOWED = {
    "order_id": "OD- followed by digits",
    "amount_paise": amount_rule(MAX_PAISE),
    "reason": REASONS,
}


def problem(field: str, received, allowed) -> dict:
    return {"field": field, "received": received, "allowed": allowed}


def invalid(problems: list) -> dict:
    return {"error": "invalid_arguments", "retryable": True, "problems": problems}


def whole_number(value) -> bool:
    # True is an int in Python, and the API spends it as 1.
    return isinstance(value, int) and not isinstance(value, bool)


def check(args: dict) -> list:
    """Every problem with these arguments, in the table's order, then the
    fields the tool does not take, in the order the model sent them."""
    problems = []

    order_id = args.get("order_id")
    if not (isinstance(order_id, str) and ORDER_ID.match(order_id)):
        problems.append(problem("order_id", order_id, ALLOWED["order_id"]))

    amount = args.get("amount_paise")
    if not (whole_number(amount) and 1 <= amount <= MAX_PAISE):
        problems.append(problem("amount_paise", amount, ALLOWED["amount_paise"]))

    reason = args.get("reason")
    if reason not in REASONS:
        problems.append(problem("reason", reason, ALLOWED["reason"]))

    for field, value in args.items():
        if field not in FIELDS:
            problems.append(problem(field, value, list(FIELDS)))
    return problems


def translate(answer, args: dict) -> dict:
    """What the payments API said, in the shape the model reads."""
    if not isinstance(answer, dict):
        return {"error": "unavailable", "retryable": False}
    if answer.get("status") == 200:
        return answer

    code = answer.get("code")
    if code == "PAY-4091":
        return {"error": "already_refunded", "retryable": False,
                "refunded_on": answer.get("refunded_on")}
    if code == "PAY-4221":
        limit = answer.get("refundable_paise")
        return invalid([problem("amount_paise", args.get("amount_paise"), amount_rule(limit))])
    if code == "PAY-4001":
        field = answer.get("field")
        return invalid([problem(field, args.get(field), ALLOWED.get(field, list(FIELDS)))])
    return {"error": "unavailable", "retryable": False}


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Customer: {question}\n"

    for _ in range(MAX_CALLS):
        reply = llm(scratchpad)

        final = FINAL.search(reply)
        if final:
            return final.group(1).strip()

        action = ACTION.search(reply)
        try:
            args = json.loads(action.group(1)) if action else None
        except ValueError:
            args = None
        if not isinstance(args, dict):
            observation = {"error": "invalid_arguments", "retryable": True,
                           "problems": [], "detail": "the arguments were not one JSON object"}
        else:
            problems = check(args)
            if problems:
                observation = invalid(problems)
            else:
                try:
                    answer = tools["refund"](**args)
                except Exception:  # the service did not answer; a new call will not help now
                    answer = None
                observation = translate(answer, args)

        scratchpad += f"{reply}\nObservation: {json.dumps(observation)}\n"

    return "I could not process this refund. A person will pick up your ticket."

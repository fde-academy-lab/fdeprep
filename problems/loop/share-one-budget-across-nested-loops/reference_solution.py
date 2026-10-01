"""Reference solution for share-one-budget-across-nested-loops.

Every model call goes through one function that counts it, whichever loop
makes it, so the planner's calls and every executor's calls come out of the
same budget. Nothing else can bound a run with loops inside loops: a cap per
loop multiplies, and the total is whatever the caps happen to allow together.

Before each step the planner works out the step's share from what is left,
after keeping back the one call the summary needs, divided by the steps still
to run. A step that finishes early leaves its calls to the steps after it, and
a step that never converges is cut off at its share instead of starving them.

An executor that runs out has not finished, and it says so: partial, with the
last thing its tools returned. The summary is written from those statuses, so
it cannot claim a step that never completed.
"""

import json
import re

BUDGET = 12

PLAN_PROMPT = (
    "Plan the onboarding for this order form. Reply with Plan: and a JSON list "
    "of step names, chosen from create_workspace, import_users, configure_sso "
    "and set_up_billing.\n"
    "Order form: {order}\n"
)

STEP_PROMPT = (
    "Step: {step}\n"
    "Order form: {order}\n"
    "Reply with Action: <tool>(<key>=<value>, ...) to call a tool, or with "
    "Done: <what the step achieved> when the step is finished.\n"
)

SUMMARY_PROMPT = (
    "Summarise the onboarding for the client's IT lead in two sentences. Say "
    "which steps are done and which are not.\n"
    "{lines}\n"
)

PLAN = re.compile(r"Plan:\s*(\[.*\])", re.DOTALL)
ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)
DONE = re.compile(r"^Done:\s*(.*)$", re.MULTILINE | re.DOTALL)
SUMMARY = re.compile(r"Summary:\s*(.*)$", re.DOTALL)


def arguments(raw: str) -> dict:
    """Turn 'name=Acme, seats=40' into {'name': 'Acme', 'seats': '40'}."""
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def parse_plan(reply: str) -> list:
    found = PLAN.search(reply)
    if found is None:
        return []
    try:
        steps = json.loads(found.group(1))
    except ValueError:
        return []
    return [step for step in steps if isinstance(step, str)] if isinstance(steps, list) else []


def run_step(step: str, question: str, share: int, ask, tools: dict) -> tuple:
    """One step's executor, on at most share model calls. Returns (status, detail)."""
    if share <= 0:
        return "not_started", None

    prompt = STEP_PROMPT.format(step=step, order=question)
    last = None  # the step's last tool result, which is all a partial step has to show
    for _ in range(share):
        reply = ask(prompt)

        done = DONE.search(reply)
        if done:
            return "done", done.group(1).strip()

        action = ACTION.search(reply)
        if action is None or action.group(1) not in tools:
            prompt += f"{reply}\nThat was neither an action nor Done.\n"
            continue

        try:
            result = tools[action.group(1)](**arguments(action.group(2)))
        except Exception as exc:  # a tool that raises has still answered the step
            result = {"error": type(exc).__name__}
        last = result
        prompt += f"{reply}\nResult: {json.dumps(result)}\n"

    return "partial", last


def run_agent(question: str, llm, tools: dict) -> str:
    spent = [0]

    def ask(prompt: str) -> str:
        spent[0] += 1
        return llm(prompt)

    plan = parse_plan(ask(PLAN_PROMPT.format(order=question)))

    steps, details = {}, {}
    for position, step in enumerate(plan):
        left = BUDGET - spent[0]
        share = (left - 1) // (len(plan) - position)  # the 1 is the summary's call
        steps[step], details[step] = run_step(step, question, share, ask, tools)

    lines = "\n".join(f"{step}: {status}" for step, status in steps.items())
    summary = ""
    if BUDGET - spent[0] >= 1:
        found = SUMMARY.search(ask(SUMMARY_PROMPT.format(lines=lines)))
        summary = found.group(1).strip() if found else ""

    return json.dumps({"steps": steps, "details": details, "summary": summary})

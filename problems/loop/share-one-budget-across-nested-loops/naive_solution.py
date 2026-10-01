"""What an unprepared learner writes in four minutes.

The planner plans once and summarises once, and each step's executor gets three
tries of its own. Nothing adds the executors' calls together, and a step whose
executor used up its tries is recorded as done, because the loop around it
ended. The summary is written from those statuses, so it says every step is
complete.
"""

import json
import re

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

ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    plan = json.loads(llm(PLAN_PROMPT.format(order=question)).split("Plan:", 1)[1])
    steps, details = {}, {}

    for step in plan:
        prompt = STEP_PROMPT.format(step=step, order=question)
        for _ in range(3):
            reply = llm(prompt)
            if reply.startswith("Done:"):
                details[step] = reply[len("Done:"):].strip()
                break
            action = ACTION.search(reply)
            if action:
                args = dict(pair.strip().split("=", 1) for pair in action.group(2).split(",") if "=" in pair)
                result = tools[action.group(1)](**args)
                details[step] = result
                prompt += f"{reply}\nResult: {json.dumps(result)}\n"
        steps[step] = "done"

    lines = "\n".join(f"{step}: {status}" for step, status in steps.items())
    summary = llm(SUMMARY_PROMPT.format(lines=lines)).split("Summary:", 1)[-1].strip()
    return json.dumps({"steps": steps, "details": details, "summary": summary})

"""What an unprepared learner writes in four minutes.

It resumes from the checkpoint, which is what a checkpoint is for. Every step
not recorded as complete is run again, because as far as this process knows it
never happened, and as far as the mail provider knows it did.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Resume: {question}\n"
    report = {"ran": [], "skipped": [], "reconciled": [], "blocked": [], "note": ""}

    for _ in range(8):
        output = llm(scratchpad)

        if "Action:" not in output:
            report["note"] = output.strip()
            return json.dumps(report)

        action = re.search(r"Action:\s*(\w+)\(", output, re.MULTILINE)
        if action is None:
            continue

        state = tools[action.group(1)]() or {}
        done = set(state.get("completed_steps") or [])

        for step in state.get("plan") or []:
            step_id = step.get("id")
            if step_id in done:
                report["skipped"].append(step_id)
                continue
            tools["run"](step=step_id)
            report["ran"].append(step_id)

        return json.dumps(report)

    return json.dumps(report)

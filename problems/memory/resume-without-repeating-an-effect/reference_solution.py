"""Reference solution for resume-without-repeating-an-effect.

A checkpoint records what this process believes. A ledger records what the
world observed. The gap between them is a step that completed and a process
that died before the write landed, and no ordering of the two writes closes
it: checkpoint-first turns the same crash into work marked done that never
happened.

Idempotence decides whether the ledger is worth asking. Re-creating an account
is free; a second single-use discount code is not, so the extra call is spent
only where repeating the step would cost something.

An unreadable ledger stops the run. Reading a missing field as false sends the
email; reading it as true leaves onboarding half done and silent. Choosing
between those is not this code's decision to make.
"""

import json
import re

_ACTION = re.compile(r"Action:\s*(\w+)\(", re.MULTILINE)


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Resume: {question}\n"
    report = {"ran": [], "skipped": [], "reconciled": [], "blocked": [], "note": ""}

    for _ in range(8):
        output = llm(scratchpad)

        if "Action:" not in output:
            report["note"] = output.strip()
            return json.dumps(report)

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        state = tools[action.group(1)]() or {}
        done = set(state.get("completed_steps") or [])
        plan = state.get("plan")
        if not isinstance(plan, list):
            report["note"] = "The checkpoint was unreadable, so nothing was resumed."
            return json.dumps(report)

        for step in plan:
            step_id = step.get("id")

            if step_id in done:
                report["skipped"].append(step_id)
                continue

            if not step.get("idempotent", False):
                seen = tools["ledger"](step=step_id) or {}
                observed = seen.get("observed")
                if observed is None:
                    report["blocked"].append(step_id)
                    continue
                if observed:
                    report["reconciled"].append(step_id)
                    continue

            tools["run"](step=step_id)
            report["ran"].append(step_id)

        if not report["reconciled"] and not report["blocked"]:
            return json.dumps(report)

        scratchpad += (
            f"{output}\nSteps reconciled against the ledger: "
            f"{', '.join(report['reconciled']) or 'none'}. Steps blocked: "
            f"{', '.join(report['blocked']) or 'none'}. Write one line for the operator.\n"
        )

    return json.dumps(report)

"""What an unprepared learner writes in four minutes.

It records that the payout tool was approved and executes the current plan
when the model says go. The approval is real and the click is real; it is
recorded against the tool name, so a plan that is re-made between the click
and the call is covered by an approval nobody gave.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Request: {question}\n"
    approved_tool = None
    proposal = None
    refused = False

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return json.dumps({
                "outcome": "not_approved" if refused else "refused", "paid_args": None,
                "reason": output.split("Final Answer:", 1)[1].strip(),
            })

        if "Revise:" in output:
            proposal = json.loads(output.split("Revise:", 1)[1].strip())
            scratchpad += f"{output}\nPlan revised.\n"
            continue

        if "Propose:" in output:
            proposal = json.loads(output.split("Propose:", 1)[1].strip())
            reply = tools["approve"](digest=proposal.get("tool")) or {}
            scratchpad += f"{output}\nObservation: {json.dumps(reply)}\n"

            if reply.get("approved") is not True:
                refused = True
                scratchpad += "Approval: not approved\n"
                continue

            approved_tool = proposal.get("tool")
            scratchpad += "Approval: approved\n"
            continue

        if "Execute:" in output:
            if approved_tool is None or proposal is None:
                scratchpad += f"{output}\nNothing to execute.\n"
                continue
            args = proposal.get("args") or {}
            tools[approved_tool](**args)
            return json.dumps({
                "outcome": "paid", "paid_args": args,
                "reason": "the payout tool was approved",
            })

        scratchpad += f"{output}\nThat was not a valid reply.\n"

    return json.dumps({"outcome": "refused", "paid_args": None, "reason": "nothing executed"})

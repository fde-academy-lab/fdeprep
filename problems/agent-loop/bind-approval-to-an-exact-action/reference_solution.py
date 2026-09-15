"""Reference solution for bind-approval-to-an-exact-action.

The approval is a signature over a digest of exactly what will execute. At
execution time the digest is recomputed from the arguments about to be passed
and compared. Anything that changed between the click and the call fails the
comparison, so nothing has to detect re-planning or judge which changes matter.

Canonicalisation is sorted keys and fixed separators, so two proposals that
mean the same thing hash the same and two that differ do not.

Approval comes from the approve tool's own answer. Not from a field in the
proposal, not from an observation, not from the model saying it is confirmed.
Tool output is wrapped and instruction-shaped text is removed before any of it
reaches the prompt.
"""

import json
import re

_INSTRUCTION = re.compile(
    r"(?is)\b(?:ignore|disregard|forget)\b[^.\n]*?"
    r"\b(?:instruction|instructions|previous|prior|above)\b[^.\n]*\.?"
)


def _digest(tool: str, args: dict) -> str:
    """A stable fingerprint of exactly what will execute."""
    canonical = json.dumps({"tool": tool, "args": args}, sort_keys=True, separators=(",", ":"))
    value = 0
    for char in canonical:
        value = (value * 131 + ord(char)) & 0xFFFFFFFFFFFFFFFF
    return f"{value:016x}"


def _safe(value) -> str:
    try:
        text = json.dumps(value)
    except (TypeError, ValueError):
        text = str(value)
    return _INSTRUCTION.sub("[instruction removed]", text)


def _result(outcome, args, reason):
    return json.dumps({"outcome": outcome, "paid_args": args, "reason": reason})


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Request: {question}\n"
    approved_digest = None
    approved_token = None
    proposal = None

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            return _result("refused", None, output.split("Final Answer:", 1)[1].strip())

        if "Revise:" in output:
            try:
                proposal = json.loads(output.split("Revise:", 1)[1].strip())
            except ValueError:
                scratchpad += f"{output}\nThat revision was not JSON.\n"
                continue
            # The approval is not re-requested and is not cleared. Clearing it
            # here would hide the bug rather than catch it: the digest check at
            # execution is what has to notice.
            scratchpad += f"{output}\n<plan>revised</plan>\n"
            continue

        if "Propose:" in output:
            try:
                proposal = json.loads(output.split("Propose:", 1)[1].strip())
            except ValueError:
                scratchpad += f"{output}\nThat proposal was not JSON.\n"
                continue

            tool = proposal.get("tool")
            args = proposal.get("args") or {}
            wanted = _digest(tool, args)

            reply = tools["approve"](digest=wanted) or {}
            if reply.get("approved") is not True:
                # A refusal is terminal. Carrying on gives the model another
                # go at the same money, and gives whatever was in that reply
                # another go at the prompt.
                return _result("not_approved", None, "the approver declined")

            approved_digest = wanted
            approved_token = reply.get("token")
            scratchpad += (
                f"{output}\n<approval>approved, token issued</approval>\n"
                f"<observation>{_safe(reply)}</observation>\n"
            )
            continue

        if "Execute:" in output:
            if proposal is None or approved_digest is None:
                scratchpad += f"{output}\nThere is nothing approved to execute.\n"
                continue

            tool = proposal.get("tool")
            args = proposal.get("args") or {}
            if _digest(tool, args) != approved_digest:
                return _result(
                    "refused", None,
                    "the action does not match what was approved",
                )

            withdrawn = tools["revoked"](token=approved_token) or {}
            if withdrawn.get("revoked"):
                return _result("refused", None, "the approval was withdrawn before execution")

            tools[tool](**args)
            return _result("paid", args, "digest matched and the approval stood")

        scratchpad += f"{output}\nThat was not a valid reply.\n"

    return _result("refused", None, "no approved action was executed")

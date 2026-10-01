"""Reference solution for resume-a-paused-run-with-the-persons-edit.

The checkpoint says what ran, and nothing in it runs again. Before anything
runs, two things have to hold: the checkpoint can be read, and the person's
decision was made for the step that is paused. A pause lands at the next step
boundary, so an edit can arrive for a step that already finished, and
applying it to whatever is paused now would be a guess. Either failure goes
to a person.

The decision settles the paused step. The model is never asked what that
step should have been, because it would propose its own version again.

The record the model reads holds every step as it actually ran: the edited
arguments, not the proposal they replaced, and a line for a rejection with
the person's reason. The model writes later steps from that record, so this
is what keeps the person's change in force after the resume.

A tool that has already run in this run, before the pause or after it, or
that the person rejected, is refused if the model proposes it again, and the
refusal goes into the record so the model can move on.
"""

import json
import re

MAX_MODEL_CALLS = 5


def _report(outcome, ran, refused, summary):
    return json.dumps({"outcome": outcome, "ran": ran, "refused": refused,
                       "summary": summary})


def _readable(checkpoint):
    return (isinstance(checkpoint, dict)
            and isinstance(checkpoint.get("ran"), list)
            and isinstance(checkpoint.get("paused"), dict)
            and isinstance(checkpoint["paused"].get("tool"), str)
            and isinstance(checkpoint.get("decision"), dict))


def _settle(decision, paused):
    """The arguments the paused step runs with, or None when it does not run.

    Raises ValueError for a decision of any shape other than the three.
    """
    kind = decision.get("type")
    if kind == "approve":
        args = paused.get("args")
        return args if isinstance(args, dict) else {}
    if kind == "edit" and isinstance(decision.get("args"), dict):
        return decision["args"]
    if kind == "reject":
        return None
    raise ValueError("not an approve, an edit carrying args, or a reject")


def _ran_line(tool, args):
    return f"Ran: {tool} {json.dumps(args, sort_keys=True)}"


def _read_step(reply):
    """The step in a `Step:` reply, or None when there is none to read."""
    text = str(reply).strip()
    if not text.startswith("Step:"):
        return None
    try:
        step = json.loads(text[len("Step:"):])
    except ValueError:
        return None
    if not isinstance(step, dict) or not isinstance(step.get("tool"), str):
        return None
    args = step.get("args")
    return step["tool"], (args if isinstance(args, dict) else {})


def run_agent(question: str, llm, tools: dict) -> str:
    try:
        checkpoint = tools["checkpoint"](run=question)
    except Exception:
        checkpoint = None
    if not _readable(checkpoint):
        return _report("needs_person", [], [],
                       "The checkpoint could not be read, so nothing was resumed.")

    paused = checkpoint["paused"]
    decision = checkpoint["decision"]
    if decision.get("step") != paused.get("step"):
        return _report("needs_person", [], [],
                       f"The decision was made for step {decision.get('step')}, and step "
                       f"{paused.get('step')} is the one paused.")
    try:
        args = _settle(decision, paused)
    except ValueError:
        return _report("needs_person", [], [],
                       "The decision on the paused step is not one the resume can act on.")

    lines = [f"Request: {checkpoint.get('request', '')}"]
    already = set()      # tools that ran in this run, before the pause or after it
    for step in checkpoint["ran"]:
        if isinstance(step, dict) and isinstance(step.get("tool"), str):
            lines.append(_ran_line(step["tool"], step.get("args") or {}))
            already.add(step["tool"])

    ran, refused, rejected = [], [], set()
    tool = paused["tool"]
    if args is None:
        rejected.add(tool)
        reason = decision.get("message") or "a person rejected this step"
        lines.append(f"Rejected: {tool} {json.dumps(paused.get('args') or {}, sort_keys=True)}: "
                     f"{reason}")
    else:
        tools[tool](**args)
        ran.append(tool)
        already.add(tool)
        lines.append(_ran_line(tool, args))

    for _ in range(MAX_MODEL_CALLS):
        reply = str(llm("\n".join(lines) + "\nReply with the next Step, or Done.\n")).strip()
        if reply.startswith("Done"):
            summary = reply.split(":", 1)[1].strip() if ":" in reply else ""
            return _report("completed", ran, refused, summary)

        step = _read_step(reply)
        if step is None:
            return _report("needs_person", ran, refused,
                           "The model replied with something that is not a step.")
        name, step_args = step
        if name in rejected or name in already or name not in tools:
            refused.append(name)
            why = ("a person rejected it" if name in rejected
                   else "it already ran in this run" if name in already
                   else "there is no such tool")
            lines.append(f"Refused: {name}: {why}")
            continue

        tools[name](**step_args)
        ran.append(name)
        already.add(name)
        lines.append(_ran_line(name, step_args))

    return _report("needs_person", ran, refused,
                   "The model did not finish within its budget of model calls.")

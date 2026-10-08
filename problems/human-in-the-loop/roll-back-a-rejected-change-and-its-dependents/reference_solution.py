"""Reference solution for roll-back-a-rejected-change-and-its-dependents.

Reversibility decides who waits. A change the platform can undo goes live at
once and a reviewer sees it in the morning. Anything else, an email above
all, waits for a person, and it also waits for every review beneath it:
approving the email itself says nothing about the price it quotes.

A rejection travels along the built-on links in one direction, downstream.
The set to undo is every rejected action plus everything built on one,
however indirectly, and nothing else. An action that merely ran later stays,
and so does whatever the rejected action was built on.

The undo walks from the most recently run action backwards, so whatever was
built on an action is gone before the action itself. An undo that does not
answer undone true leaves its action live, and a live action pins everything
beneath it, because a banner pointing at a deleted bundle is a second
incident. Those actions are stuck, and the report says so for a person.
"""

import json
import re

UNDO = {
    "set_price": "restore_price",
    "create_bundle": "delete_bundle",
    "schedule_banner": "cancel_banner",
}


def _read_action(reply):
    """The action in an `Action:` reply, or None when there is none to read."""
    text = str(reply).strip()
    if not text.startswith("Action:"):
        return None
    try:
        action = json.loads(text[len("Action:"):])
    except ValueError:
        return None
    if not isinstance(action, dict):
        return None
    if not isinstance(action.get("id"), str) or not isinstance(action.get("tool"), str):
        return None
    args = action.get("args")
    built_on = action.get("depends_on")
    return {
        "id": action["id"],
        "tool": action["tool"],
        "args": args if isinstance(args, dict) else {},
        "depends_on": ([other for other in built_on if isinstance(other, str)]
                       if isinstance(built_on, list) else []),
    }


def _beneath(action_id, actions):
    """Everything an action was built on, directly or through other actions.

    An id the planner never proposed stays in the set: nobody can review it,
    so anything resting on it can never be cleared to run.
    """
    seen = set()
    stack = list(actions[action_id]["depends_on"])
    while stack:
        other = stack.pop()
        if other in seen:
            continue
        seen.add(other)
        if other in actions:
            stack.extend(actions[other]["depends_on"])
    return seen


def _call(tools, name, **kwargs):
    """A tool's answer, or None when the call raised."""
    try:
        return tools[name](**kwargs)
    except Exception:
        return None


def _ask(action, tools):
    """Put one irreversible action to the approver, and act on the answer."""
    answer = _call(tools, "approve", action_id=action["id"])
    if isinstance(answer, dict) and answer.get("approved") is True:
        tools[action["tool"]](**action["args"])
        return "ran"
    if isinstance(answer, dict) and answer.get("approved") is False:
        return "refused"
    # No answer is nobody deciding, which is neither a yes nor a no.
    return "held"


def run_agent(question: str, llm, tools: dict) -> str:
    actions = {}
    proposed = []
    live = []          # reversible actions that ran, in the order they ran
    status = {}        # what became of each irreversible action
    transcript = f"Night run {question}. Propose the next action, or reply Done.\n"

    for _ in range(12):
        reply = llm(transcript)
        action = _read_action(reply)
        if action is None:
            break
        transcript += f"{str(reply).strip()}\n"
        actions[action["id"]] = action
        proposed.append(action["id"])

        if action["tool"] in UNDO:
            tools[action["tool"]](**action["args"])
            live.append(action["id"])
        elif _beneath(action["id"], actions):
            # Nothing has been reviewed during the run, so it waits.
            status[action["id"]] = "waiting"
        else:
            status[action["id"]] = _ask(action, tools)

    reviews = _call(tools, "reviews", run=question)
    decisions = reviews.get("decisions") if isinstance(reviews, dict) else None
    if not isinstance(decisions, dict):
        decisions = {}

    # Whatever an action was built on ran before it, so one pass in run order
    # carries every rejection all the way downstream.
    doomed = set()
    for action_id in live:
        if (decisions.get(action_id) == "rejected"
                or any(other in doomed for other in actions[action_id]["depends_on"])):
            doomed.add(action_id)

    undone, stuck, pinned = [], [], set()
    for action_id in reversed(live):
        if action_id not in doomed:
            continue
        if action_id not in pinned:
            answer = _call(tools, UNDO[actions[action_id]["tool"]], action_id=action_id)
            if isinstance(answer, dict) and answer.get("undone") is True:
                undone.append(action_id)
                continue
        # Still live, so everything it was built on has to stay live with it.
        stuck.append(action_id)
        pinned.update(actions[action_id]["depends_on"])

    for action_id in proposed:
        if status.get(action_id) != "waiting":
            continue
        beneath = _beneath(action_id, actions)
        if any(other in doomed for other in beneath):
            status[action_id] = "cancelled"
        elif all(decisions.get(other) == "approved" for other in beneath):
            status[action_id] = _ask(actions[action_id], tools)
        else:
            status[action_id] = "held"

    def having(state):
        return [action_id for action_id in proposed if status.get(action_id) == state]

    return json.dumps({
        "undone": undone,
        "stuck": stuck,
        "held": having("held"),
        "refused": having("refused"),
        "cancelled": having("cancelled"),
    })

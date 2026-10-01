"""Reference solution for follow-the-policy-version-in-force.

Rank says how well a chunk matches the words of the question, and an old
policy often matches them better than its replacement, because the question
was asked in the old policy's words. Which version applies is a fact about
dates, so it is decided from dates, before anything reaches the prompt.

Chunks that share a doc are versions of one policy. The version in force has
the latest effective_from on or before the as-of date. Older versions are
superseded, later ones are not yet in force, every chunk of the version in
force stays, and different docs never conflict.

Versions are set aside before the two prompt places are filled. Filling them
first lets a superseded chunk take the place its replacement needed. A
set-aside chunk never reaches the prompt, labelled or not: a label asks the
model to ignore something, and leaving the chunk out means it cannot be used.

With no evidence the loop answers for itself. Asked anyway, the model would
answer from what it was trained on, which is the old policy.
"""

import json
import re

MAX_CHUNKS = 2
NOTHING = "I could not find a policy that covers this."

_ACTION = re.compile(r"Action:\s*search\((?:query=)?(.*?)\)\s*$", re.MULTILINE)
_QUESTION = re.compile(r"as_of=(\d{4}-\d{2}-\d{2})\|(.*)", re.DOTALL)
_FIELDS = {"id", "doc", "effective_from"}


def run_agent(question: str, llm, tools: dict) -> str:
    found = _QUESTION.match(question)
    if found is None:
        return _record(NOTHING, [], {})
    as_of, text = found.group(1), found.group(2).strip()

    scratchpad = f"Question: {text}\nThe question is asked on {as_of}.\n"
    followed, set_aside = [], {}

    for _ in range(6):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip() or NOTHING
            return _record(answer, followed, set_aside)

        action = _ACTION.search(output)
        if action is None:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        in_force, set_aside = resolve(_chunks(tools, action.group(1).strip()), as_of)
        chosen = sorted(in_force, key=lambda c: -float(c.get("score", 0)))[:MAX_CHUNKS]
        if not chosen:
            return _record(NOTHING, [], set_aside)

        followed = [c["id"] for c in chosen]
        blocks = "\n".join(
            f"[{c['id']} | {c['doc']} | in force from {c['effective_from']}] {c.get('text', '')}"
            for c in chosen
        )
        scratchpad += f"{output}\n<evidence>\n{blocks}\n</evidence>\n"

    return _record(NOTHING, [], set_aside)


def resolve(chunks: list, as_of: str) -> tuple:
    """The chunks of each doc's version in force, and every other chunk's id
    mapped to the reason it was set aside."""
    in_force_from = {}
    for chunk in chunks:
        date = chunk["effective_from"]
        if date <= as_of and date > in_force_from.get(chunk["doc"], ""):
            in_force_from[chunk["doc"]] = date

    kept, set_aside = [], {}
    for chunk in chunks:
        date = chunk["effective_from"]
        if date > as_of:
            set_aside[chunk["id"]] = "not_yet_in_force"
        elif date < in_force_from[chunk["doc"]]:
            set_aside[chunk["id"]] = "superseded"
        else:
            kept.append(chunk)
    return kept, set_aside


def _chunks(tools: dict, query: str) -> list:
    """Search's chunks, or nothing when search raises or reports an error."""
    try:
        reply = tools["search"](query=query)
    except Exception:
        return []
    if not isinstance(reply, dict) or reply.get("error"):
        return []
    chunks = reply.get("chunks")
    if not isinstance(chunks, list):
        return []
    return [c for c in chunks if isinstance(c, dict) and _FIELDS <= c.keys()]


def _record(answer: str, followed: list, set_aside: dict) -> str:
    return json.dumps({"answer": answer, "followed": followed, "set_aside": set_aside})

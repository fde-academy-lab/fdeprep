"""Reference solution for cancel-without-one-more-action.

The console stamps the run state on every reply and every tool response, as it
stood when that response arrived. The loop reads the latest stamp at every
point where something is about to leave it: before the first action of a
reply, before each later action of the same reply, and before asking the model
for another turn. A plan made while the run was live is not permission to act
once it is not.

Only "live" means live. A cancelled stamp stops the run, and so does a
response that carries no stamp at all, because nobody has said that run may
continue. After that nothing goes out, and the model is not asked for a
summary either: the note is written here.
"""

import json
import re

_ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)
_FINAL = re.compile(r"^Final Answer:\s*(.*)$", re.MULTILINE)
_RUN = re.compile(r"^Run:\s*(\w+)", re.MULTILINE)

MAX_TURNS = 4


def _arguments(raw: str) -> dict:
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def _stamp_on_reply(reply: str):
    found = _RUN.search(reply)
    return found.group(1) if found else None


def _stamp_on_response(result):
    return result.get("run") if isinstance(result, dict) else None


def _report(outcome: str, dispatched: list, held: list, note: str) -> str:
    return json.dumps({"outcome": outcome, "dispatched": dispatched,
                       "held": held, "note": note})


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Task: {question}\n"
    dispatched = []

    for _ in range(MAX_TURNS):
        reply = llm(scratchpad)
        planned = [(name, raw.strip()) for name, raw in _ACTION.findall(reply)]
        written = [f"{name}({raw})" for name, raw in planned]

        if _stamp_on_reply(reply) != "live":
            return _report("cancelled", dispatched, written,
                           "The run was not live when this reply arrived, so none "
                           "of its actions went out.")

        if not planned:
            final = _FINAL.search(reply)
            if final:
                return _report("finished", dispatched, [], final.group(1).strip())
            scratchpad += f"{reply}\nThat was not a valid action.\n"
            continue

        for position, (name, raw) in enumerate(planned):
            if name not in tools:
                scratchpad += f"There is no tool called {name}, so it was not called.\n"
                continue

            result = tools[name](**_arguments(raw))
            dispatched.append(written[position])

            # The response is the freshest word on the run. Everything the reply
            # planned after this point waits on it.
            if _stamp_on_response(result) != "live":
                return _report("cancelled", dispatched, written[position + 1:],
                               f"The run stopped being live after {written[position]}, "
                               "so nothing after it went out.")

            scratchpad += (f"Action: {written[position]}\n"
                           f"<observation>{json.dumps(result)}</observation>\n")

    return _report("unfinished", dispatched, [],
                   "The model calls ran out before the work was finished.")

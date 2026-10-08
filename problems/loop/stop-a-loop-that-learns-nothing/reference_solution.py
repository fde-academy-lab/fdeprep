"""Reference solution for stop-a-loop-that-learns-nothing.

Progress is a change in what the loop knows. A call that comes back with
something it has not returned before is progress, however often the model has
made it: a batch one step further along is a poll doing its job. A call that
comes back with exactly what it returned before, at any earlier step, taught
the loop nothing, and the next call will teach it nothing either.

So the loop remembers every answer each call has given, and decides what
"the same" means on purpose. The same call is the tool with its arguments
sorted, because the model writes one call in more than one order. The same
answer is the result without checked_at, which changes on every call and says
nothing about the money. And the memory reaches back past the step before,
because two calls taking turns repeat without ever repeating in a row.

The step limit stays. A batch that moves a little on every poll never repeats,
and only the limit ends that chat.
"""

import json
import re

MAX_STEPS = 6
ACTION = re.compile(r"^Action:\s*(\w+)\((.*)\)\s*$", re.MULTILINE)
FINAL = re.compile(r"^Final Answer:\s*(.*)$", re.MULTILINE | re.DOTALL)
VOLATILE = ("checked_at",)


def arguments(raw: str) -> dict:
    """Turn 'merchant=M-1, date=2026-09-14' into {'merchant': 'M-1', 'date': '2026-09-14'}."""
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def same_call(tool: str, args: dict) -> tuple:
    """Equal for two calls exactly when they are the same call, in any argument order."""
    return (tool, tuple(sorted(args.items())))


def substance(result):
    """The result as it counts for progress: everything except checked_at."""
    if isinstance(result, dict):
        return {key: value for key, value in result.items() if key not in VOLATILE}
    return result


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Merchant: {question}\n"
    seen = {}    # same_call key -> every answer that call has given, as JSON
    last = None  # the last result, without checked_at

    for step in range(1, MAX_STEPS + 1):
        reply = llm(scratchpad)

        final = FINAL.search(reply)
        if final:
            return final.group(1).strip()

        if step == MAX_STEPS:
            break  # nobody would read what this action returns

        action = ACTION.search(reply)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{reply}\nThat was not an action you can take.\n"
            continue

        tool, args = action.group(1), arguments(action.group(2))
        result = tools[tool](**args)
        last = substance(result)

        answers = seen.setdefault(same_call(tool, args), set())
        answer = json.dumps(last, sort_keys=True, default=str)
        if answer in answers:
            return (f"No progress: {tool} returned the same result twice. "
                    f"Last result: {json.dumps(last)}")
        answers.add(answer)

        scratchpad += f"{reply}\nObservation: {json.dumps(result)}\n"

    return (f"Step limit reached: {MAX_STEPS} model calls without an answer. "
            f"Last result: {json.dumps(last)}")

"""Reference solution for order-units-of-work-by-their-dependencies.

The model is asked once for a map of which units depend on which, in one
shape. A reply in any other shape gets one more ask that carries it back,
because the same prompt gets the same reply; a second bad reply goes to the
delivery lead.

Every id in the map is checked against the plan before anything is ordered.
An id the plan does not have, a title included, is a question for a person,
since dropping it schedules the unit that needed it as if it needed nothing.

The ordering is Kahn's algorithm: keep what each unit still waits on, place
the lowest ready id, and repeat. When nothing is ready and units are left,
they cannot all be placed. Following dependencies among them until one
repeats finds the loop itself, and a unit that only waits on the loop is
left out of it. A loop is never broken here, because only someone who knows
the work can say which dependency is wrong.
"""

import json

# The one shape the model is asked to reply in, ids only.
SHAPE = 'Depends: {"UW-2": ["UW-1"], "UW-3": ["UW-1", "UW-2"]}'


def run_agent(question: str, llm, tools: dict) -> str:
    units = tools["plan"]()["units"]
    ids = sorted(unit["id"] for unit in units)

    prompt = ask(units)
    reply = llm(prompt)
    depends = read_depends(reply)
    if depends is None:
        reply = llm(f"{prompt}\n\nYour reply was:\n{reply}\n\nThat is not the shape "
                    f"asked for. Reply with one line in exactly this shape, ids only:\n{SHAPE}")
        depends = read_depends(reply)
    if depends is None:
        return for_a_person([{"problem": "the model did not reply in the Depends: shape"}])

    unknown = [{"unit": unit, "problem": f"depends on {other}, which is not in the plan"}
               for unit in ids for other in depends.get(unit, []) if other not in ids]
    if unknown:
        return for_a_person(unknown)

    waiting = {unit: set(depends.get(unit, [])) for unit in ids}
    order = []
    while True:
        ready = [unit for unit, needs in waiting.items() if not needs]
        if not ready:
            break
        unit = min(ready)
        order.append(unit)
        del waiting[unit]
        for needs in waiting.values():
            needs.discard(unit)

    if waiting:
        return for_a_person([{"cycle": loop(waiting),
                              "problem": "these units depend on each other"}])
    return json.dumps({"outcome": "ordered", "order": order, "problems": []})


def ask(units: list) -> str:
    listing = "\n".join(f"{unit['id']}: {unit['title']}. {unit['description']}"
                        for unit in units)
    return ("These are the units of work in a delivery plan.\n\n" + listing +
            "\n\nSay which units depend on which other units, using the ids only. "
            "Reply with one line in this shape and nothing else:\n" + SHAPE)


def read_depends(reply: str):
    """The map in a Depends: reply, or None when the reply is in any other shape."""
    text = reply.strip()
    if not text.startswith("Depends:"):
        return None
    try:
        depends = json.loads(text[len("Depends:"):])
    except ValueError:
        return None
    if not isinstance(depends, dict):
        return None
    for needs in depends.values():
        if not isinstance(needs, list) or not all(isinstance(other, str) for other in needs):
            return None
    return depends


def loop(waiting: dict) -> list:
    """The units of one loop among those left, sorted.

    Every unit left still waits on another unit left, so following the lowest
    dependency from the lowest unit must come round to a unit already seen.
    The units from there on are the loop; any before it only wait on it.
    """
    path, unit = [], min(waiting)
    while unit not in path:
        path.append(unit)
        unit = min(waiting[unit])
    return sorted(path[path.index(unit):])


def for_a_person(problems: list) -> str:
    return json.dumps({"outcome": "needs_person", "order": [], "problems": problems})

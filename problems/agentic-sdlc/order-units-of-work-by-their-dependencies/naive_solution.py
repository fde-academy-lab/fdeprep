"""What an unprepared learner writes in four minutes.

It asks the model once, reads the map, and orders the units by taking the
lowest ready id each time, which is right whenever the model's answer is
clean. Everything else becomes an order anyway. A dependency on an id the
plan does not have is filtered out, so the unit that needed it is scheduled
as if it needed nothing. When units wait on each other the loop takes the
lowest of them and carries on, which is week three's alphabet. A reply that
is not JSON raises, and nothing asks the model a second time.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    units = tools["plan"]()["units"]
    ids = sorted(unit["id"] for unit in units)
    listing = "\n".join(f"{u['id']}: {u['title']}. {u['description']}" for u in units)
    reply = llm(f"Units of work:\n{listing}\n\nWhich units depend on which? "
                'Reply as Depends: {"UW-2": ["UW-1"]} using ids only.')
    deps = json.loads(reply.split("Depends:", 1)[1])

    waiting = {u: {d for d in deps.get(u, []) if d in ids} for u in ids}
    order = []
    while waiting:
        ready = sorted(u for u in waiting if not waiting[u]) or sorted(waiting)
        order.append(ready[0])
        del waiting[ready[0]]
        for rest in waiting.values():
            rest.discard(ready[0])
    return json.dumps({"outcome": "ordered", "order": order, "problems": []})

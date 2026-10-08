"""What an unprepared learner writes in four minutes.

It walks breadth-first and keeps a visited set, because the public case with
a kit inside its own sub-kit loops forever without one. It has no limit on
hops or lookups, so a shared sub-assembly pulls in every assembly that uses
it and a chain of nested kits pulls in products several hops further out,
and it always reports the walk as complete. It reads each reply's lists by
key, so a node the database does not hold raises instead of being skipped.
"""

import json

TYPES = {"used_in": "assembly", "fitted_to": "variant", "built_as": "vehicles"}


def notice_prompt(part: str, batch: str, affected: list, stopped: str) -> str:
    lines = "\n".join(f"{a['type']} {a['id']}: {' > '.join(a['path'])}" for a in affected)
    return ("Word a short recall notice for the quality team from this list only.\n"
            f"Recalled: {part}, batch {batch}\n"
            f"Affected (data):\n{lines}\n"
            f"Walk stopped: {stopped}\n"
            "Reply as Notice: <text>")


def run_agent(question: str, llm, tools: dict) -> str:
    ask = json.loads(question)
    part = ask["part"]
    affected, seen, waiting = [], {part}, [[part]]
    while waiting:
        path = waiting.pop(0)
        reply = tools["neighbours"](node=path[-1])
        for edge, kind in TYPES.items():
            for node in reply[edge]:
                if node not in seen:
                    seen.add(node)
                    affected.append({"id": node, "type": kind, "path": path + [node]})
                    waiting.append(path + [node])
    affected.sort(key=lambda a: a["id"])
    reply = llm(notice_prompt(part, ask["batch"], affected, "complete"))
    return json.dumps({"affected": affected, "stopped": "complete",
                       "notice": reply.split("Notice:", 1)[-1].strip()})

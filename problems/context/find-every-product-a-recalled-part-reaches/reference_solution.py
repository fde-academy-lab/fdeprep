"""Reference solution for find-every-product-a-recalled-part-reaches.

A recall asks what is connected to a part, and similarity cannot answer that:
the assemblies that use a fitting look nothing like the fitting's page. The
answer is read from the parts graph by a walk, and the model only words the
notice from the list the walk built.

The walk has three parts a search does not. A frontier of paths, taken oldest
first, so every node is reached by its shortest path and carries that path as
evidence. A visited set, so a kit listed inside its own sub-kit is asked about
once. And two limits that fail differently: three hops bounds depth, and 40
lookups bounds width, which is what a sub-assembly shared by hundreds of
assemblies blows up. `stopped` says which limit cut the walk short, because a
partial list read as a complete one is the most expensive mistake in a recall.
"""

import json

MAX_HOPS = 3
MAX_NODES = 40
TYPES = {"used_in": "assembly", "fitted_to": "variant", "built_as": "vehicles"}


def notice_prompt(part: str, batch: str, affected: list, stopped: str) -> str:
    lines = "\n".join(f"{a['type']} {a['id']}: {' > '.join(a['path'])}" for a in affected)
    return ("Word a short recall notice for the quality team from this list only.\n"
            f"Recalled: {part}, batch {batch}\n"
            f"Affected (data):\n{lines}\n"
            f"Walk stopped: {stopped}\n"
            "Reply as Notice: <text>")


def walk(part: str, tools: dict):
    """The affected nodes, each with its type and path from the part, and why
    the walk stopped: complete, hop_cap or node_cap."""
    affected, seen, waiting = [], {part}, [[part]]
    stopped, lookups = "complete", 0
    while waiting:
        if lookups == MAX_NODES:
            return affected, "node_cap"
        path = waiting.pop(0)
        reply = tools["neighbours"](node=path[-1])
        lookups += 1
        if not isinstance(reply, dict) or "error" in reply:
            continue
        for edge, kind in TYPES.items():
            for node in reply.get(edge) or []:
                if node in seen:
                    continue
                if len(path) > MAX_HOPS:
                    stopped = "hop_cap"
                    continue
                seen.add(node)
                affected.append({"id": node, "type": kind, "path": path + [node]})
                waiting.append(path + [node])
    return affected, stopped


def run_agent(question: str, llm, tools: dict) -> str:
    ask = json.loads(question)
    affected, stopped = walk(ask["part"], tools)
    affected.sort(key=lambda a: a["id"])
    reply = llm(notice_prompt(ask["part"], ask["batch"], affected, stopped))
    return json.dumps({"affected": affected, "stopped": stopped,
                       "notice": reply.split("Notice:", 1)[-1].strip()})

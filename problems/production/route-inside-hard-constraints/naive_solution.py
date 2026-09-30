"""What an unprepared learner writes in four minutes.

It walks the client's preference list and takes the first model under the
latency and cost ceilings, treating a missing measurement as zero. Residency is
not one of the numbers it compares, so an EU claim goes to the first fast,
cheap model on the list wherever that model is hosted. When nothing is under
the ceilings it falls back to the old default route, which is also in the US,
and a model that times out takes the whole request down with it.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    routing = tools["routing"]()
    request = routing["request"]
    candidates = {c["id"]: c for c in routing["candidates"]}

    for model in routing["preference"]:
        candidate = candidates[model]
        fast = (candidate.get("p95_ms") or 0) <= request["max_p95_ms"]
        price = candidate.get("usd_per_1k_tokens") or 0
        cheap = request["tokens"] / 1000 * price <= request["max_cost_usd"]
        if fast and cheap:
            reply = tools[model](prompt=question)
            return json.dumps({"model": model, "outcome": "answered",
                               "answer": reply.get("text"),
                               "reason": "the first model under both ceilings"})

    return json.dumps({"model": "default", "outcome": "answered", "answer": llm(question),
                       "reason": "nothing on the list qualified"})

"""Reference solution for route-inside-hard-constraints.

Hard constraints filter and preferences order, and the two never trade. A
candidate meets residency, the latency ceiling and the cost ceiling, or it does
not exist for this claim. The client's preference order decides among the ones
that remain, and the fallback walks the same filtered list, so an outage can
change which qualifying model answers and can never change what qualifies.

Unknown fails. A model with no latency measurement cannot be shown to meet a
ceiling, so it does not qualify until somebody measures it. The price is per
thousand tokens and the ceiling is per claim, so the comparison happens after
the multiplication.

When nothing qualifies, or every qualifying model fails, the answer is a
refusal that names what ruled each model out. The old default route is a model
in the US, and falling back to it would repeat the incident.
"""

import json


def cost_usd(candidate: dict, request: dict) -> float | None:
    """What this claim would cost on this candidate, or None if unknown."""
    price = candidate.get("usd_per_1k_tokens")
    tokens = request.get("tokens")
    if price is None or tokens is None:
        return None
    return tokens / 1000 * price


def failed_constraint(candidate: dict, request: dict) -> str | None:
    """None when the candidate meets every hard constraint, otherwise the
    name of the first one it fails."""
    residency = request.get("residency")
    if residency is not None and candidate.get("residency") != residency:
        return "residency"
    p95 = candidate.get("p95_ms")
    if p95 is None or p95 > request.get("max_p95_ms", 0):
        return "latency"
    cost = cost_usd(candidate, request)
    if cost is None or cost > request.get("max_cost_usd", 0):
        return "cost"
    return None


def _result(model, outcome, answer, reason):
    return json.dumps({"model": model, "outcome": outcome, "answer": answer, "reason": reason})


def run_agent(question: str, llm, tools: dict) -> str:
    routing = tools["routing"]() or {}
    request = routing.get("request") or {}
    candidates = {c.get("id"): c for c in routing.get("candidates") or []}

    qualifying, ruled_out = [], []
    for model in routing.get("preference") or []:
        candidate = candidates.get(model)
        if candidate is None or model not in tools:
            ruled_out.append(f"{model} has no endpoint")
            continue
        failed = failed_constraint(candidate, request)
        if failed:
            ruled_out.append(f"{model} fails {failed}")
        else:
            qualifying.append(model)

    for model in qualifying:
        try:
            reply = tools[model](prompt=question) or {}
        except Exception:
            ruled_out.append(f"{model} did not answer")
            continue
        if reply.get("status") == 200 and reply.get("text"):
            return _result(model, "answered", reply["text"], f"{model} met every constraint")
        ruled_out.append(f"{model} answered with status {reply.get('status')}")

    return _result(None, "refused", None,
                   "; ".join(ruled_out) or "no candidates are configured for this client")

"""Reference solution for cap-each-tenant-without-starving-others.

Every run is decided before anything is counted, and only a run that is sent
counts toward a window or a budget. A refusal therefore costs nothing, which
is what keeps one tenant's flood of refused runs from filling the account's
minute for everyone behind it.

The budget check uses the only number known about a call's cost before it
runs, its max_tokens. The call is charged what the provider reports, so the
unused part of the ceiling goes back to the tenant, except when the call
raises: then nobody knows what it used, and the ceiling stands.
"""

import json

WINDOW_S = 60


def _refused(reason: str, retry_at_s=None) -> dict:
    return {"status": "refused", "reason": reason, "retry_at_s": retry_at_s}


def _limits(tools: dict):
    """Each tenant's plan and the account's limit, or (None, 0) when the plans
    did not arrive. No plans means nothing is known to be allowed."""
    try:
        reply = tools["plans"]()
    except Exception:
        return None, 0
    if not isinstance(reply, dict) or not isinstance(reply.get("tenants"), dict):
        return None, 0
    return reply["tenants"], int(reply.get("account_rpm") or 0)


def run_agent(question: str, llm, tools: dict) -> str:
    batch = tools["batch"]()
    runs = batch.get("runs") if isinstance(batch, dict) else None
    tenants, account_rpm = _limits(tools)

    spent = {}          # tokens charged to each tenant
    tenant_sent = {}    # (tenant, window) -> runs sent
    account_sent = {}   # window -> runs sent, all tenants
    answers = {}

    for run in runs or []:
        run_id, tenant = run["id"], run["tenant"]
        ceiling = int(run["max_tokens"])
        window = int(run["at_s"]) // WINDOW_S
        next_window = (window + 1) * WINDOW_S

        plan = tenants.get(tenant) if tenants else None
        if not isinstance(plan, dict):
            answers[run_id] = _refused("no_plan")
            continue
        if spent.get(tenant, 0) + ceiling > plan["tokens"]:
            answers[run_id] = _refused("token_budget")
            continue
        if tenant_sent.get((tenant, window), 0) >= plan["rpm"]:
            answers[run_id] = _refused("tenant_rate", next_window)
            continue
        if account_sent.get(window, 0) >= account_rpm:
            answers[run_id] = _refused("account_rate", next_window)
            continue

        # Decided: only now does the run count, and its ceiling is reserved.
        tenant_sent[(tenant, window)] = tenant_sent.get((tenant, window), 0) + 1
        account_sent[window] = account_sent.get(window, 0) + 1
        spent[tenant] = spent.get(tenant, 0) + ceiling
        try:
            reply = tools["complete"](run=run_id, prompt=run["prompt"], max_tokens=ceiling)
        except Exception:
            answers[run_id] = {"status": "failed"}
            continue

        used = reply.get("tokens") if isinstance(reply, dict) else None
        if not isinstance(used, int):
            answers[run_id] = {"status": "failed"}
            continue
        spent[tenant] += used - ceiling
        answers[run_id] = {"status": "done", "tokens": used}

    return json.dumps(answers)

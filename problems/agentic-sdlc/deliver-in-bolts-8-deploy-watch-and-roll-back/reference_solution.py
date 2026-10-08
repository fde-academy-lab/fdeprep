import json

NEXT_ACTION = "page the platform team lead"


def run_agent(question: str, llm, tools: dict) -> str:
    record = tools["deploy_record"]()
    dep, version, target = record["id"], record["version"], record.get("rollback_to")
    out = {"deploy": {"id": dep, "decision": "refused", "reason": "no_rollback_to"},
           "guard": None, "live": None, "missing": [], "rollback": None,
           "next_action": None, "events": []}
    events = out["events"]

    # Without a way back there is nothing the rollback rule could do later.
    if not target:
        events.append(_event("DEPLOY_DECIDED", dep, "refused",
                             f"{dep} names no release to roll back to, so {version} was not deployed."))
        return json.dumps(out)

    tools["deploy"](deploy=dep, release=version)
    out["deploy"] = {"id": dep, "decision": "deployed", "reason": None}
    out["live"] = version
    events.append(_event("DEPLOY_DECIDED", dep, "deployed",
                         f"{version} deployed, with {target} as the way back."))

    guard = record["guard"]
    metric, floor, window = guard["metric"], guard["threshold"], guard["window_days"]
    run, any_value = [], False
    for read in tools["metrics"](deploy=dep) or []:
        value = read.get(metric)
        if value is None:
            # No evidence either way: the count stays where it was.
            out["missing"].append(read["id"])
            events.append(_event("SAMPLE_READ", read["id"], "missing",
                                 f"No {metric} read; still {len(run)} under in a row."))
            continue
        any_value = True
        under = value < floor
        run = run + [read] if under else []
        events.append(_event("SAMPLE_READ", read["id"], "under" if under else "clear",
                             f"{metric} {value} against {floor}; {len(run)} under in a row."))
        if len(run) == window:
            break

    if len(run) < window:
        out["guard"] = "held" if any_value else "no_reads"
        return json.dumps(out)

    out["guard"] = "fell"
    answer = tools["rollback"](deploy=dep, to=target) or {}
    error = answer.get("error")
    done = not error and answer.get("rolled_back_to") == target
    out["rollback"] = {"id": "RB-1", "deploy": dep, "rolled_back_to": target if done else None,
                       "triggered_by": [r["id"] for r in run], "reads": [r[metric] for r in run],
                       "threshold": floor, "state": "done" if done else "failed", "error": error}
    if done:
        out["live"] = target
    else:
        out["next_action"] = NEXT_ACTION
    events.append(_event("ROLLBACK_DECIDED", "RB-1", "done" if done else "failed",
                         f"{window} reads under {floor} in a row; {out['live']} is live."))
    return json.dumps(out)


def _event(kind: str, ref: str, outcome: str, note: str) -> dict:
    return {"kind": kind, "ref": ref, "outcome": outcome, "note": note}

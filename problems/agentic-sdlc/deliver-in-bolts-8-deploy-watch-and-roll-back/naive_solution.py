import json


def run_agent(question: str, llm, tools: dict) -> str:
    record = tools["deploy_record"]()
    dep = record["id"]
    tools["deploy"](deploy=dep, release=record["version"])
    events = [{"kind": "DEPLOY_DECIDED", "ref": dep, "outcome": "deployed",
               "note": f"{record['version']} deployed in the window."}]
    live, guard, rollback = record["version"], "held", None

    for read in tools["metrics"](deploy=dep):
        value = read["first_time_fix"]
        under = value < 58
        events.append({"kind": "SAMPLE_READ", "ref": read["id"],
                       "outcome": "under" if under else "clear", "note": read["note"]})
        if under:
            answer = tools["rollback"](deploy=dep, to=record["rollback_to"])
            state = "done" if answer["status"] == 200 else "failed"
            rollback = {"id": "RB-1", "deploy": dep, "rolled_back_to": record["rollback_to"],
                        "triggered_by": [read["id"]], "reads": [value], "threshold": 58,
                        "state": state, "error": None}
            live, guard = record["rollback_to"], "fell"
            events.append({"kind": "ROLLBACK_DECIDED", "ref": "RB-1", "outcome": state,
                           "note": f"Rolled back to {record['rollback_to']}."})
            break

    return json.dumps({"deploy": {"id": dep, "decision": "deployed", "reason": None},
                       "guard": guard, "live": live, "missing": [], "rollback": rollback,
                       "next_action": None, "events": events})

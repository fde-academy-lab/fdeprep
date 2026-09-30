"""What an unprepared learner writes in four minutes.

It reads the record, skips the steps it shows as completed and keeps their
outputs, and runs everything else again, including a failure the record says
a second try will not change. When a completed step left no output behind,
the reference to it comes out as None and the step that needed it runs
anyway, so the email goes out with no refund reference in it.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(f"Retry: {question}\n")
    steps = json.loads(reply.split("Plan:", 1)[1])["steps"]
    record = (tools["run_record"]() or {}).get("steps", {})
    outputs = {}
    report = {"reused": [], "completed": [], "failed": [], "blocked": []}

    for step in steps:
        entry = record.get(step["id"], {})
        if entry.get("state") == "completed":
            outputs[step["id"]] = entry.get("output")
            report["reused"].append(step["id"])
            continue

        args = {}
        for key, value in step["args"].items():
            if isinstance(value, str) and value.startswith("$"):
                source, field = value[1:].split(".", 1)
                value = (outputs.get(source) or {}).get(field)
            args[key] = value

        result = tools[step["tool"]](**args)
        if isinstance(result, dict) and result.get("status") == 200 and "error" not in result:
            outputs[step["id"]] = result
            report["completed"].append(step["id"])
        else:
            report["failed"].append(step["id"])

    return json.dumps(report)

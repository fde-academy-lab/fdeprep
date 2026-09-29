"""What an unprepared learner writes in four minutes.

One scratchpad for the batch and one tool table for everybody. Each job is
appended to what the jobs before it left behind, so the second client's prompt
opens with the first client's lookup, and whatever tool the model names gets
called, whichever client it belongs to.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    jobs = tools["jobs"]()["jobs"]
    answers = {}
    scratchpad = f"Batch {question}\n"

    for job in jobs:
        scratchpad += f"Job {job['id']} for {job['tenant']}: {job['ask']}\n"
        for _ in range(3):
            output = llm(scratchpad)
            if "Final Answer:" in output:
                answers[job["id"]] = output.split("Final Answer:", 1)[1].strip()
                break
            action = re.search(r"Action:\s*(\w+)\(", output)
            result = tools[action.group(1)]()
            scratchpad += f"{output}\nObservation: {json.dumps(result)}\n"

    return json.dumps({"answers": answers, "not_served": []})

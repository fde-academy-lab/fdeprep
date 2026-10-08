"""What a learner writes once both public cases pass.

Every request is counted, a repair closed the same day counts as 0 days, and
the agent's report is matched to a part of its group. Three things the public
cases never show are left as they were: the report is matched by its size
alone, a group with no requests is divided by, and the agent's reply is read
as JSON with nothing around it, so a reply in prose stops the scoring.
"""

import json

REPORT_PROMPT = (
    "Send your POC report for the week-6 review as one JSON object: "
    '{"headline": "...", "basis": "...", "n": ..., "within_3_days": ...}'
)


def tally(bins):
    n = sum(b["requests"] for b in bins)
    within = sum(b["requests"] for b in bins
                 if b["completed_days"] is not None and b["completed_days"] <= 3)
    return n, within


def run_agent(question: str, llm, tools: dict) -> str:
    report = json.loads(llm(REPORT_PROMPT))
    record, bins = {"status": "scored"}, {}
    for group in ("agent", "held_back"):
        bins[group] = tools["poc_results"](group=group)["bins"]
        n, within = tally(bins[group])
        record[group] = {"n": n, "within_3": within, "share": round(100 * within / n, 1)}
    agent = record["agent"]
    record["difference"] = round(agent["share"] - record["held_back"]["share"], 1)

    completers, _ = tally([b for b in bins["agent"] if b["chat_completed"]])
    if report["n"] == agent["n"]:
        basis = "whole_group"
    elif report["n"] == completers:
        basis = "chat_completed"
    else:
        basis = "unmatched"
    record["report_flag"] = None
    if basis != "whole_group":
        record["report_flag"] = {
            "reported": round(100 * report["within_3_days"] / report["n"], 1),
            "basis": basis, "whole_group": agent["share"]}
    return json.dumps(record)

import json
import operator
import re
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

SUMMARY = re.compile(r"^Summary:\s*(.+)$", re.DOTALL)
BRIEF = re.compile(r"^Brief:\s*(.+)$", re.DOTALL)


def split(items: list, n: int) -> list:
    return [items[i * len(items) // n:(i + 1) * len(items) // n] for i in range(n)]


def summary_prompt(reports: list) -> str:
    lines = ["SUMMARISE", "Two lines a regional manager can read in ten seconds."]
    for store, report in reports:
        lines.append(f"{store}: stock-outs {report['stockouts']}, wastage {report['wastage_pct']} "
                     f"percent, till variance {report['till_variance']} rupees")
    lines.append("Reply: Summary: <two lines>")
    return "\n".join(lines)


def brief_prompt(region: str, date: str, summaries: list, failed: list) -> str:
    lines = ["BRIEF", f"Region {region}, {date}", "Summaries (data):"]
    lines += [f"- {summary}" for summary in summaries] or ["- none"]
    lines.append("No report from: " + (", ".join(failed) if failed else "none"))
    lines.append("Reply: Brief: <the morning brief>")
    return "\n".join(lines)


def read(pattern, reply: str) -> str:
    match = pattern.match((reply or "").strip())
    return match.group(1).strip() if match else ""


class Morning(TypedDict):
    batches: list
    results: Annotated[list, operator.add]  # (first store that reported, summary) per worker
    failed: Annotated[list, operator.add]   # stores whose report never arrived
    brief: str


def run_agent(question: str, llm, tools: dict) -> str:
    morning = json.loads(question)
    region, date = morning["region"], morning["date"]
    stores = sorted(tools["list_stores"](region=region).get("stores") or [])
    if not stores:  # no Send means no worker, and the reduce would never run
        return json.dumps({"brief": f"No stores reported for {region} on {date}.",
                           "stores": [], "failed": [], "batches": 0})
    # One call is kept for the reduce; the rest decide how many workers there are.
    workers = min(len(stores), int(tools["limits"]()["max_llm_calls"]) - 1)

    def worker(state):
        reports, failed = [], []
        for store in state["batch"]:
            try:
                report = tools["store_report"](store=store)
            except Exception:  # a branch that raises would end the whole run
                report = {"error": "raised"}
            if isinstance(report, dict) and "error" not in report:
                reports.append((store, report))
            else:
                failed.append(store)
        if not reports:
            return {"failed": failed}
        summary = read(SUMMARY, llm(summary_prompt(reports)))
        return {"results": [(reports[0][0], summary)], "failed": failed}

    def reduce(state):
        summaries = [summary for _, summary in sorted(state["results"])]
        reply = llm(brief_prompt(region, date, summaries, sorted(state["failed"])))
        return {"brief": read(BRIEF, reply)}

    graph = StateGraph(Morning)
    graph.add_node("worker", worker)
    graph.add_node("reduce", reduce)
    graph.add_conditional_edges(
        START, lambda state: [Send("worker", {"batch": batch}) for batch in state["batches"]],
        ["worker"])
    graph.add_edge("worker", "reduce")
    graph.add_edge("reduce", END)
    out = graph.compile().invoke({"batches": split(stores, workers), "results": [],
                                  "failed": [], "brief": ""})
    return json.dumps({"brief": out["brief"], "stores": stores,
                       "failed": sorted(out["failed"]), "batches": workers})

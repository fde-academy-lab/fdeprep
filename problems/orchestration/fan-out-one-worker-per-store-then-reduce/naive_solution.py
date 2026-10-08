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
    stores: list
    results: Annotated[list, operator.add]
    failed: Annotated[list, operator.add]
    brief: str


def run_agent(question: str, llm, tools: dict) -> str:
    ask = json.loads(question)
    stores = tools["list_stores"](region=ask["region"])["stores"]

    def worker(state):
        store = state["store"]
        report = tools["store_report"](store=store)
        if "error" in report:
            return {"failed": [store]}
        summary = read(SUMMARY, llm(summary_prompt([(store, report)])))
        return {"results": [{"store": store, "report": report, "summary": summary}]}

    def reduce(state):
        everything = [json.dumps(result) for result in state["results"]]
        reply = llm(brief_prompt(ask["region"], ask["date"], everything, state["failed"]))
        return {"brief": read(BRIEF, reply)}

    graph = StateGraph(Morning)
    graph.add_node("worker", worker)
    graph.add_node("reduce", reduce)
    graph.add_conditional_edges(
        START, lambda state: [Send("worker", {"store": store}) for store in state["stores"]],
        ["worker"])
    graph.add_edge("worker", "reduce")
    graph.add_edge("reduce", END)
    out = graph.compile().invoke({"stores": stores, "results": [], "failed": [], "brief": ""})
    return json.dumps({"brief": out["brief"], "stores": stores, "failed": out["failed"],
                       "batches": len(stores)})

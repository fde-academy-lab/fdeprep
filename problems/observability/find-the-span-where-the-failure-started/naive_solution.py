"""What an unprepared learner writes in four minutes.

It links each span to its parent as it reads the list, which works while
parents come first and raises a KeyError the moment a child arrives before
its parent or names one that never arrived. It then takes the first failed
span in the list with no failed child. That finds the right span on a simple
run, and on a busier one it picks a timeout that a retry already handled, or
the slower of two failures that happened at once.
"""

import json


def run_agent(question, llm, tools):
    trace = tools["trace"](trace_id=question)
    spans = trace["spans"]

    by_id, children = {}, {}
    for span in spans:
        by_id[span["span_id"]] = span
        children[span["span_id"]] = []
        if span["parent_id"]:
            children[span["parent_id"]].append(span)

    failed = [s for s in spans if s["status"] == "error"]
    cause = None
    for span in failed:
        if not any(c["status"] == "error" for c in children[span["span_id"]]):
            cause = span
            break

    path = []
    node = cause
    while node:
        path.insert(0, node["name"])
        node = by_id.get(node["parent_id"]) if node["parent_id"] else None

    return json.dumps({"cause": cause["span_id"] if cause else None, "path": path,
                       "orphans": [], "failed": len(failed)})

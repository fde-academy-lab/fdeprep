"""Reference solution for find-the-span-where-the-failure-started.

Every span is indexed before any is linked, because spans reach the collector
when they end, so a child is usually listed before its parent. A span whose
parent is not in the trace, or names itself, is an orphan: it becomes the top
of a tree of its own rather than raising, or vanishing with whatever failed
inside it.

A failure matters to the run only when it travelled up, so the failure path
is the failed spans whose every ancestor in the trace failed too. A failure
under a span that succeeded was handled, usually by a retry, and it is a red
herring however early it happened. The cause is the span on that path with no
failed child that ended first, because a failure happens when its span ends,
and a sibling that failed later is often failing because of it.

The walk up the parents keeps a set of the spans it has passed, so a trace
with a loop in its parent ids cannot keep it going round.
"""

import json

FAR = float("inf")


def run_agent(question: str, llm, tools: dict) -> str:
    data = tools["trace"](trace_id=question) or {}
    spans = [s for s in (data.get("spans") or []) if isinstance(s, dict) and s.get("span_id")]

    by_id = {}
    for span in spans:
        by_id.setdefault(span["span_id"], span)

    def is_orphan(span) -> bool:
        parent = span.get("parent_id")
        return parent is not None and (parent == span["span_id"] or parent not in by_id)

    def parent_of(span):
        """The span's parent in the trace, or None for a root or an orphan."""
        if span.get("parent_id") is None or is_orphan(span):
            return None
        return by_id[span["parent_id"]]

    def ancestors(span) -> list:
        """Parent first, then upwards, stopping at a root, an orphan or a loop."""
        chain, passed = [], {span["span_id"]}
        node = parent_of(span)
        while node is not None and node["span_id"] not in passed:
            chain.append(node)
            passed.add(node["span_id"])
            node = parent_of(node)
        return chain

    def failed(span) -> bool:
        return span.get("status") == "error"

    with_failed_child = {parent_of(s)["span_id"] for s in spans
                         if failed(s) and parent_of(s) is not None}
    candidates = [
        (s.get("end_ms", FAR), s.get("start_ms", FAR), position, s)
        for position, s in enumerate(spans)
        if failed(s) and all(failed(a) for a in ancestors(s))
        and s["span_id"] not in with_failed_child
    ]
    cause = min(candidates, key=lambda c: c[:3])[3] if candidates else None
    path = ([a.get("name") for a in reversed(ancestors(cause))] + [cause.get("name")]
            if cause else [])

    return json.dumps({
        "cause": cause["span_id"] if cause else None,
        "path": path,
        "orphans": [s["span_id"] for s in spans if is_orphan(s)],
        "failed": sum(1 for s in spans if failed(s)),
    })

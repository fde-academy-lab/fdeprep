"""Reference solution for record-a-redacted-timeline.

A trace is written for the engineer at 2am and stored where far more people can
read it than can read the customer database. So every detail is masked before
it is stored, and cut to length after it is masked, in that order: a cut made
first can leave half an email address or half a card number behind, and no
pattern recognises half of one.

Error messages get the same treatment as inputs. They are where credentials
travel, because a client library that fails an authenticated request quotes
the request back.

A span with no end is the most important line on the timeline, because it is
where the run was when it stopped. It keeps its place with no duration and a
status of its own, and it decides the run's outcome.

The model writes the summary from the masked steps and never sees the raw
events, because anything in its prompt can come back out in its reply.
"""

import json
import re

LIMIT = 160
_MASKS = (
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[email]"),
    (re.compile(r"\b(?:\d[ -]?){12,18}\d\b"), "[card]"),
    (re.compile(r"(?i)\bBearer\s+\S+"), "Bearer [secret]"),
    (re.compile(r"(?i)\bapi_key=\S+"), "api_key=[secret]"),
)


def mask(text: str) -> str:
    for pattern, placeholder in _MASKS:
        text = pattern.sub(placeholder, text)
    return text


def bound(text: str) -> str:
    return text if len(text) <= LIMIT else text[: LIMIT - 3] + "..."


def run_agent(question: str, llm, tools: dict) -> str:
    data = tools["run_events"]() or {}
    starts, ends = {}, {}
    for event in data.get("events") or []:
        if event.get("type") == "start":
            starts[event.get("span")] = event
        elif event.get("type") == "end":
            ends[event.get("span")] = event

    steps = []
    ordered = sorted(starts.values(), key=lambda e: e.get("at_ms", 0))
    for n, start in enumerate(ordered, 1):
        end = ends.get(start.get("span"))
        detail = str(start.get("detail") or "")
        if end and end.get("detail"):
            detail = f"{detail} -> {end['detail']}"
        steps.append({
            "n": n,
            "span": start.get("span"),
            "name": start.get("name"),
            "ms": end["at_ms"] - start["at_ms"] if end else None,
            "status": end.get("status", "ok") if end else "unfinished",
            "detail": bound(mask(detail)),
        })

    statuses = {step["status"] for step in steps}
    if "unfinished" in statuses:
        outcome = "unfinished"
    elif "error" in statuses:
        outcome = "failed"
    else:
        outcome = "succeeded"

    summary = llm(
        "Summarise this agent run in one line for the incident channel.\n"
        f"<timeline>{json.dumps(steps)}</timeline>"
    ).strip()
    return json.dumps({"run_id": data.get("run_id"), "outcome": outcome,
                       "steps": steps, "summary": summary})

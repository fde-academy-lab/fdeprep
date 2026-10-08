"""Reference solution for record-every-call-the-agent-makes.

The record is written around each call, not after it. A call that raises
never reaches the line below it, so a recorder that writes when a call
returns loses exactly the call the engineer needed. The tool call sits in a
try block, and one event is built from whatever happened: an envelope, an
envelope whose status is not 200, or an exception.

A call that answered is not a call that worked. A status other than 200 is
an error outcome that still has a latency, and an exception is an error
outcome with none, because nothing measured one.

The record keeps what a replay needs: the model's text exactly as it came
back, and each tool's arguments and output, in the order they happened. The
totals are added up from the events, so the two can never disagree.
"""

import json
import re

ACTION = re.compile(r"Action:\s*(\w+)\((.*)\)")


def parse_args(text: str) -> dict:
    """order_id=88-1204, slot=sat-am -> {"order_id": "88-1204", "slot": "sat-am"}"""
    args = {}
    for part in filter(None, (p.strip() for p in text.split(","))):
        name, _, value = part.partition("=")
        args[name.strip()] = value.strip()
    return args


def call_tool(tool, args: dict) -> tuple:
    """(output, ms, outcome) for one tool call, whatever happens inside it."""
    try:
        envelope = tool(**args)
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}", None, "error"
    if not isinstance(envelope, dict):
        return envelope, None, "error"
    if envelope.get("status") != 200:
        return envelope.get("error"), envelope.get("ms"), "error"
    return envelope.get("data"), envelope.get("ms"), "ok"


def run_agent(question: str, llm, tools: dict) -> str:
    events = []
    scratchpad = f"Customer: {question}\n"
    answer = "I could not finish this request."

    for _ in range(4):
        reply = json.loads(llm(scratchpad))
        text = reply.get("text", "")
        usage = reply.get("usage") or {}
        events.append({
            "seq": len(events) + 1, "call": "model", "output": text,
            "input_tokens": usage.get("inputTokens", 0),
            "output_tokens": usage.get("outputTokens", 0),
            "ms": (reply.get("metrics") or {}).get("latencyMs"),
            "outcome": "ok",
        })

        if text.startswith("Final Answer:"):
            answer = text[len("Final Answer:"):].strip()
            break

        action = ACTION.search(text)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{text}\nObservation: that is not a tool you have.\n"
            continue
        name, args = action.group(1), parse_args(action.group(2))

        output, ms, outcome = call_tool(tools[name], args)
        events.append({"seq": len(events) + 1, "call": "tool", "name": name, "args": args,
                       "output": output, "ms": ms, "outcome": outcome})
        seen = output if outcome == "ok" else f"error: {output}"
        scratchpad += f"{text}\nObservation: {json.dumps(seen)}\n"

    totals = {
        "model_calls": sum(1 for e in events if e["call"] == "model"),
        "tool_calls": sum(1 for e in events if e["call"] == "tool"),
        "input_tokens": sum(e.get("input_tokens", 0) for e in events),
        "output_tokens": sum(e.get("output_tokens", 0) for e in events),
        "errors": sum(1 for e in events if e["outcome"] == "error"),
    }
    return json.dumps({"answer": answer, "events": events, "totals": totals})

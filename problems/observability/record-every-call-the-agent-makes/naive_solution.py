"""What an unprepared learner writes in four minutes.

It writes an event on the line after each call returns, which records every
call that went well. The booking call that raises never returns, so the
except branch tells the model and nothing writes its event. The booking call
that answers with a refusal comes back, so it is written down as ok.
"""

import json
import re

ACTION = re.compile(r"Action:\s*(\w+)\((.*)\)")


def parse_args(text):
    args = {}
    for part in filter(None, (p.strip() for p in text.split(","))):
        name, _, value = part.partition("=")
        args[name.strip()] = value.strip()
    return args


def run_agent(question, llm, tools):
    events = []
    scratchpad = f"Customer: {question}\n"
    answer = "I could not finish this request."

    for _ in range(4):
        reply = json.loads(llm(scratchpad))
        text = reply["text"]
        events.append({"seq": len(events) + 1, "call": "model", "output": text,
                       "input_tokens": reply["usage"]["inputTokens"],
                       "output_tokens": reply["usage"]["outputTokens"],
                       "ms": reply["metrics"]["latencyMs"], "outcome": "ok"})
        if text.startswith("Final Answer:"):
            answer = text[len("Final Answer:"):].strip()
            break

        action = ACTION.search(text)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{text}\nObservation: that is not a tool you have.\n"
            continue
        name, args = action.group(1), parse_args(action.group(2))
        try:
            result = tools[name](**args)
            events.append({"seq": len(events) + 1, "call": "tool", "name": name,
                           "args": args, "output": result.get("data"),
                           "ms": result.get("ms"), "outcome": "ok"})
            scratchpad += f"{text}\nObservation: {json.dumps(result.get('data'))}\n"
        except Exception as exc:
            scratchpad += f"{text}\nObservation: {exc}\n"

    totals = {
        "model_calls": len([e for e in events if e["call"] == "model"]),
        "tool_calls": len([e for e in events if e["call"] == "tool"]),
        "input_tokens": sum(e.get("input_tokens", 0) for e in events),
        "output_tokens": sum(e.get("output_tokens", 0) for e in events),
        "errors": 0,
    }
    return json.dumps({"answer": answer, "events": events, "totals": totals})

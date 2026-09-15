"""Reference solution for resolve-a-follow-up-without-changing-intent.

The filter is applied to the turns before the prompt is built. Filtering the
rewrite afterwards cannot work: once another customer's order id is in the
context the model has a concrete referent for "the other one", and a rewrite
that says "the second parcel they mentioned" is unfilterable.

No referent among the customer's own turns means asking which order they mean.
That is the cheapest correct answer here, and a history service that returns
nothing lands in the same branch rather than a separate one.
"""

import json
import re

ASK = "I need to know which order you mean."
_ORDER = re.compile(r"\b[A-Z]-\d{3,6}\b")
_ACTION = re.compile(r"Action:\s*(\w+)\(", re.MULTILINE)


def _split(question: str):
    found = re.match(r"customer=([^|]+)\|(.*)", question, re.DOTALL)
    if found is None:
        return "", question
    return found.group(1).strip(), found.group(2).strip()


def run_agent(question: str, llm, tools: dict) -> str:
    customer, text = _split(question)
    scratchpad = f"Customer: {customer}\nQuestion: {text}\n"

    for _ in range(8):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            return answer or ASK

        if "Rewrite:" in output:
            query = output.split("Rewrite:", 1)[1].strip()
            result = tools["search"](query=query) or {}
            chunks = result.get("chunks") or []
            scratchpad += f"{output}\n<evidence>{json.dumps(chunks)}</evidence>\n"
            continue

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a valid action.\n"
            continue

        result = tools[action.group(1)]() or {}
        mine = [t for t in (result.get("turns") or []) if t.get("customer_id") == customer]
        referents = _ORDER.findall(" ".join(t.get("text", "") for t in mine))

        if not referents:
            return ASK

        lines = "\n".join(f"[{t.get('n')}] {t.get('text', '')}" for t in mine)
        scratchpad += (
            f"{output}\n<this customer's turns>\n{lines}\n</this customer's turns>\n"
            "Reply with Rewrite: followed by a standalone query.\n"
        )

    return ASK

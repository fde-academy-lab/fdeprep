"""Reference solution for key-the-cache-on-the-whole-request.

A cached answer may be served to a request when two things hold: it is the
answer this request would have produced, and this caller is allowed to read
it. The question text settles neither.

The key carries everything that shapes the answer or decides who may see it:
the tenant whose policies were used, the scope the caller's role may read, the
prompt version and the model, plus the question with case and spacing
normalised. The request id stays out, because it changes on every request and
a key that carried it would never hit.
"""

import json
import re


def build_prompt(request: dict) -> str:
    """The header lines the gateway reads. Leave this as it is."""
    return (
        f"Tenant: {request['tenant']}\n"
        f"Scope: {request['scope']}\n"
        f"Prompt: {request['prompt_version']}\n"
        f"Model: {request['model']}\n"
        f"Question: {request['question']}\n"
    )


def normalise(question: str) -> str:
    """Case and spacing do not change a question."""
    return re.sub(r"\s+", " ", question.strip().lower())


def cache_key(request: dict) -> tuple:
    return (
        request.get("tenant"),
        request.get("scope"),
        request.get("prompt_version"),
        request.get("model"),
        normalise(str(request.get("question", ""))),
    )


def run_agent(question: str, llm, tools: dict) -> str:
    cache: dict[tuple, str] = {}
    answers: dict[str, str] = {}

    for request in (tools["requests"]() or {}).get("requests") or []:
        key = cache_key(request)
        if key not in cache:
            cache[key] = llm(build_prompt(request))
        answers[request["id"]] = cache[key]

    return json.dumps(answers)

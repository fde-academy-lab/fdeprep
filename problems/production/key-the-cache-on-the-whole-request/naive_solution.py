"""What an unprepared learner writes in four minutes.

It fills in the loop and keeps the starter key, which is the question text and
nothing else. That is the incident: two people asking the same words get the
same answer, whoever employs them, whatever their role lets them read, and
whichever prompt and model wrote it.
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
    return (normalise(request["question"]),)


def run_agent(question: str, llm, tools: dict) -> str:
    cache = {}
    answers = {}

    for request in tools["requests"]().get("requests") or []:
        key = cache_key(request)
        if key not in cache:
            cache[key] = llm(build_prompt(request))
        answers[request["id"]] = cache[key]

    return json.dumps(answers)

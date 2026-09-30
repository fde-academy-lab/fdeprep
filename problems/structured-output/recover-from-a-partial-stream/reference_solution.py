"""Reference solution for recover-from-a-partial-stream.

Completion is read from the transport before the text is parsed: only the
[DONE] line says the model stopped on purpose. A stream that reached [DONE] is
still parsed and checked for every key, because a model that runs out of room
ends its stream normally with the object open.

Each event line is read on its own, and reading stops at the first line that
does not parse, which is where the connection closed. Every request gets a
fresh buffer, one retry covers a dropped connection, and after a second cut
the screen gets what arrived, marked unfinished.
"""

import json

KEYS = ("lane", "pallets", "price_pence", "valid_until")
ATTEMPTS = 2
PREFIX = "data: "


def build_prompt(job: str) -> str:
    return (
        "Quote this freight job. Reply with one JSON object with the keys "
        "lane, pallets, price_pence and valid_until.\n\n"
        f"Job: {job}\n"
    )


def read_stream(transcript: str):
    """Join the pieces of one stream. Returns (text, finished)."""
    pieces = []
    finished = False
    for line in transcript.splitlines():
        if not line.startswith(PREFIX):
            continue
        payload = line[len(PREFIX):].strip()
        if payload == "[DONE]":
            finished = True
            break
        try:
            event = json.loads(payload)
        except ValueError:
            break  # the connection closed partway through this line
        if not isinstance(event, dict) or not isinstance(event.get("text"), str):
            break
        pieces.append(event["text"])
    return "".join(pieces), finished


def as_quote(text: str, finished: bool):
    """The quote a stream carried, or None when it did not carry a whole one."""
    if not finished:
        return None
    try:
        quote = json.loads(text)
    except ValueError:
        return None
    if not isinstance(quote, dict) or any(key not in quote for key in KEYS):
        return None
    return quote


def run_agent(question: str, llm, tools: dict) -> str:
    received = ""

    for _ in range(ATTEMPTS):
        text, finished = read_stream(llm(build_prompt(question)))
        quote = as_quote(text, finished)
        if quote is not None:
            return json.dumps({"status": "complete", "quote": quote})
        received = text

    return json.dumps({"status": "interrupted", "quote": None, "received": received})

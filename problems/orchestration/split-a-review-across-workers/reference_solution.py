"""Reference solution for split-a-review-across-workers.

Each worker sees one question and one document, so its prompt holds nothing
it could answer from by mistake and nothing it should not read. A claim counts
only when its quote is found in that worker's own document with the value
inside it, which no number of agreeing guesses can fake. Proved claims are
then counted by distinct value: none is not found, one is the answer with
every document that proved it, and more than one goes to a person with the
quotes.
"""

import json


def worker_prompt(qid: str, ask: str, doc_id: str, text: str) -> str:
    return (
        "You check one document for one question. Answer only from the document.\n"
        f"Job: {qid} in {doc_id}\n"
        f"Question: {ask}\n"
        f"<document>\n{text}\n</document>\n"
        'Reply with JSON only: {"value": ..., "quote": ...}, copying the sentence '
        'you rely on exactly, or {"value": null} when the document does not answer.\n'
    )


def proved(reply: str, text: str):
    """The claim when its quote proves it against this worker's own document."""
    try:
        claim = json.loads(reply)
    except ValueError:
        return None
    if not isinstance(claim, dict):
        return None
    value, quote = claim.get("value"), claim.get("quote")
    if not (isinstance(value, str) and value.strip() and isinstance(quote, str) and quote.strip()):
        return None
    if quote not in text:
        return None
    if value.strip().lower() not in quote.lower():
        return None
    return {"value": value.strip(), "quote": quote}


def same(value: str) -> str:
    return " ".join(value.lower().split())


def line_for(qid: str, claims: list) -> str:
    if not claims:
        return f"{qid}: not found"
    if len({same(claim["value"]) for claim in claims}) == 1:
        docs = ", ".join(claim["doc"] for claim in claims)
        return f"{qid}: {claims[0]['value']} ({docs})"
    said = "; ".join(f'{claim["doc"]} says "{claim["quote"]}"' for claim in claims)
    return f"{qid}: conflict: {said}"


def run_agent(question: str, llm, tools: dict) -> str:
    request = json.loads(question)
    documents = request.get("documents") or []
    lines = []
    for item in request.get("questions") or []:
        claims = []
        for document in documents:
            text = document.get("text", "")
            # One question and one document. The rest of the request,
            # the other documents and the private note, stays out.
            reply = llm(worker_prompt(item["id"], item.get("ask", ""), document["id"], text))
            claim = proved(reply, text)
            if claim:
                claims.append({**claim, "doc": document["id"]})
        lines.append(line_for(item["id"], claims))
    return "\n".join(lines)

"""What an unprepared learner writes in four minutes.

It hands every worker the whole request so nothing is missing, and keeps the
answer most workers gave. Two workers that guessed alike outvote the one that
quoted the contract, documents that genuinely disagree are settled by count,
a reply that is not JSON raises, and the private note reaches every prompt.
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


def run_agent(question: str, llm, tools: dict) -> str:
    request = json.loads(question)
    lines = []
    for item in request["questions"]:
        votes = {}
        for document in request["documents"]:
            reply = json.loads(llm(worker_prompt(item["id"], item["ask"], document["id"],
                                                 json.dumps(request))))
            if reply.get("value"):
                votes.setdefault(reply["value"], []).append(document["id"])
        if not votes:
            lines.append(f"{item['id']}: not found")
            continue
        winner = max(votes, key=lambda value: len(votes[value]))
        lines.append(f"{item['id']}: {winner} ({', '.join(votes[winner])})")
    return "\n".join(lines)

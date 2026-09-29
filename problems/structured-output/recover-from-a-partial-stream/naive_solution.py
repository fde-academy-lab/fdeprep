"""What an unprepared learner writes in four minutes.

It joins the text of every event and parses the result. On a stream that
finished this is correct. On a stream the connection cut, json.loads raises
on the half object, or on the half line the connection closed on, and the
request dies with a stack trace instead of telling the screen what arrived.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    transcript = llm(f"Quote this freight job as JSON.\n\n{question}\n")

    text = ""
    for line in transcript.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            text += json.loads(line[len("data: "):])["text"]

    return json.dumps({"status": "complete", "quote": json.loads(text)})

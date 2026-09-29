"""What an unprepared learner writes in four minutes.

It pastes the email under the team's instruction. The model receives one
string with nothing in it to say where the instruction ends and the customer
begins, so a paragraph in the email addressed to "the AI assistant" reads as
one more instruction, and the draft follows it.
"""

import json
import re


def run_agent(question: str, llm, tools: dict) -> str:
    email = tools["read_email"]()

    prompt = (
        f"{question}\n\n"
        f"From: {email['from']}\n"
        f"Subject: {email['subject']}\n\n"
        f"{email['body']}\n"
    )

    reply = llm(prompt)
    return reply.split("Final Answer:", 1)[-1].strip()

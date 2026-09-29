"""What an unprepared learner writes in four minutes.

It fixes the incident the brief describes by reading whichever amount field
is present, and keeps the fallback to zero so that nothing crashes. Version
3 keeps the name and changes the unit, so pence reach the prompt as pounds.
An unknown version or a null amount becomes £0.00, the model is asked anyway,
and it tells the customer they owe nothing.
"""

import re


def run_agent(question: str, llm, tools: dict) -> str:
    account = re.search(r"ACC-\d+", question).group(0)
    bill = tools["billing"](account=account)

    amount = bill.get("amount", bill.get("amount_due")) or 0

    prompt = (
        f"Customer message: {question}\n"
        f"Amount due: £{amount:.2f}\n"
        f"Due date: {bill.get('due')}\n"
        "Answer the customer in one sentence, using only the figures above."
    )
    return llm(prompt)

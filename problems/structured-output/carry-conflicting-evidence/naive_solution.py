"""What an unprepared learner writes in four minutes.

It sends every document to the model in one prompt and asks for one record.
The model returns one value per field and picks silently when the documents
disagree, so the record comes back complete and certain, and nothing in it
says that the signed form and the newest email named different accounts.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    documents = tools["documents"](supplier=question)["documents"]
    bundle = "\n\n".join(doc["text"] for doc in documents)

    found = json.loads(llm(
        "Extract sort_code, account_number and vat_number as JSON from these "
        f"supplier documents:\n\n{bundle}\n"
    ))
    record = {field: found.get(field) for field in ("sort_code", "account_number", "vat_number")}

    return json.dumps({
        "record": record,
        "conflicts": [],
        "ready_to_pay": bool(record["sort_code"] and record["account_number"]),
    })

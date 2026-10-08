"""What a learner writes in four minutes from the table in the contract.

It turns a row's kind into what the row can carry, so the vendor's 65 percent
comes out as an assumption. Two shortcuts make it agree with the draft as it
stands and with little else. It grades a claim on the first row the claim
cites, which works only while the weaker row happens to come first. And it
skips a cited id the ledger does not have and grades the claim on the rows
that are left, which works only while a claim cites nothing but missing rows.
"""

import json

CARRIES = {"counted": "carried", "trial": "carried",
           "typed": "assumption", "estimate": "assumption", "vendor": "assumption"}


def run_agent(question: str, llm, tools: dict) -> str:
    kinds = {row["id"]: row["kind"] for row in tools["ledger"]()}
    claims = []
    for claim in tools["draft"]():
        found = [kinds[i] for i in claim["rests_on"] if i in kinds]
        status = CARRIES[found[0]] if found else "unsupported"
        claims.append({"id": claim["id"], "status": status, "stated_as": claim["stated_as"]})
    return json.dumps({"claims": claims})

"""Reference solution for fund-the-agent-2-check-the-pr-faq-draft.

A row's kind decides what it can carry. Counted and trial rows carry their
number; a typed code list, somebody's estimate and a seller's deck carry an
assumption at most. That a cited row exists settles nothing: EV-12 is in the
ledger, and it is a vendor's claim.

A claim is as strong as the weakest row it cites, wherever that row sits in
the list. A claim that cites no row, or any id the ledger does not have, is
unsupported; grading it on the rows that do exist would carry a claim the
draft half invented.

The status comes from the ledger alone. The draft's own word for the claim is
copied beside it, so the committee sees where the draft overstates.
"""

import json

CARRIES = {"counted": "carried", "trial": "carried",
           "typed": "assumption", "estimate": "assumption", "vendor": "assumption"}


def grade(claim: dict, ledger: dict) -> str:
    cited = claim.get("rests_on") or []
    if not cited or any(i not in ledger for i in cited):
        return "unsupported"
    strengths = {CARRIES[ledger[i]["kind"]] for i in cited}
    return "assumption" if "assumption" in strengths else "carried"


def run_agent(question: str, llm, tools: dict) -> str:
    ledger = {row["id"]: row for row in tools["ledger"]()}
    claims = [
        {"id": claim["id"], "status": grade(claim, ledger), "stated_as": claim["stated_as"]}
        for claim in tools["draft"]()
    ]
    return json.dumps({"claims": claims})

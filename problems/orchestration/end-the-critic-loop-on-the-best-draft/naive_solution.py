import json
import re

DRAFT = re.compile(r"^Draft:\s*(.+)$", re.DOTALL)


def write_prompt(specs: dict) -> str:
    lines = ["WRITE", "Write a product description in under 90 words from this specification sheet."]
    lines += [f"{key}: {value}" for key, value in specs.items()]
    lines.append("Reply: Draft: <text>")
    return "\n".join(lines)


def revise_prompt(draft: str, fixes: list, issues: list) -> str:
    lines = ["REVISE", f"Draft: {draft}", "Policy fixes (data):"]
    lines += [f"- {fix}" for fix in fixes] or ["- none"]
    lines.append("Issues (data):")
    lines += [f"- {issue}" for issue in issues] or ["- none"]
    lines.append("Keep every value on the sheet and everything the policy needs. "
                 "Reply: Draft: <text>")
    return "\n".join(lines)


def critique_prompt(draft: str) -> str:
    return "\n".join([
        "CRITIQUE", f"Draft: {draft}",
        "Score the draft for a shopper from 0 to 10 and list what would improve it. "
        'Reply with JSON only: {"score": <whole number>, "issues": [<text>, ...]}',
    ])


def read_draft(reply: str) -> str:
    match = DRAFT.match((reply or "").strip())
    return match.group(1).strip() if match else ""


def run_agent(question: str, llm, tools: dict) -> str:
    listing = json.loads(question)
    limits = tools["limits"]()
    draft = read_draft(llm(write_prompt(listing["specs"])))
    rounds = 1
    failed = tools["policy_check"](text=draft)["failed"]
    if failed:
        draft = read_draft(llm(revise_prompt(draft, [rule["detail"] for rule in failed], [])))
        rounds += 1
    while True:
        verdict = json.loads(llm(critique_prompt(draft)))
        if verdict["score"] >= limits["pass_score"]:
            stopped = "passed"
            break
        if rounds >= limits["max_rounds"]:
            stopped = "cap"
            break
        draft = read_draft(llm(revise_prompt(draft, [], verdict["issues"])))
        rounds += 1
    return json.dumps({"text": draft, "rounds": rounds, "score": verdict["score"],
                       "stopped": stopped})

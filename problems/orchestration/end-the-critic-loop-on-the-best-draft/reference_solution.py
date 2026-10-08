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


def read_score(reply: str):
    """(score, issues), or None for anything but JSON with a whole-number score from 0 to 10."""
    try:
        verdict = json.loads(reply)
    except ValueError:
        return None
    score = verdict.get("score") if isinstance(verdict, dict) else None
    if type(score) is not int or not 0 <= score <= 10:
        return None
    issues = verdict.get("issues")
    return score, [str(issue) for issue in issues] if isinstance(issues, list) else []


def finish(best, rounds: int, stopped: str) -> str:
    if best is None:
        return json.dumps({"text": "", "rounds": rounds, "score": None, "stopped": "none_passed"})
    return json.dumps({"text": best[1], "rounds": rounds, "score": best[0], "stopped": stopped})


def run_agent(question: str, llm, tools: dict) -> str:
    specs = json.loads(question)["specs"]
    limits = tools["limits"]()
    best, flat = None, 0  # best is (score, text) of the best draft that passed every rule
    draft, fixes, issues = "", [], []
    for rounds in range(1, int(limits["max_rounds"]) + 1):
        prompt = write_prompt(specs) if rounds == 1 else revise_prompt(draft, fixes, issues)
        draft = read_draft(llm(prompt))
        failed = tools["policy_check"](text=draft).get("failed") or []
        fixes = [str(rule.get("detail", "")) for rule in failed]
        # Only a draft the policy passed is worth a critic's call.
        verdict = None if failed else read_score(llm(critique_prompt(draft)))
        issues = verdict[1] if verdict else []
        if verdict and (best is None or verdict[0] > best[0]):
            best, flat = (verdict[0], draft), 0
            if verdict[0] >= limits["pass_score"]:
                return finish(best, rounds, "passed")
        else:
            flat += 1  # a failed draft, a failed critique or no gain all count
            if flat == 2:
                return finish(best, rounds, "plateau")
    return finish(best, rounds, "cap")

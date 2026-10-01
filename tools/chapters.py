"""Move every catalogue problem into its chapter, once.

Run from the repository root:

    python -m tools.chapters

Each entry names the chapter a problem now sits in, the topic inside that
chapter, and the question the problem answers, which the page shows before
the learner starts. The script moves the YAML file and its solutions folder
into problems/<chapter>/, rewrites the `track:` line, and writes a `concept:`
block under it. Running it a second time changes nothing.

Kept in the repository as the record of where each problem came from; the
chapter assignments are the author's construction, made on 1 October 2026.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBLEMS = ROOT / "problems"

# slug: (chapter, topic, question)
MAP: dict[str, tuple[str, str, str]] = {
    # Loop engineering
    "route-tickets-with-rules": ("loop", "Do you need a loop?",
        "Can plain rules route this ticket without any model at all?"),
    "route-tickets-with-a-decision-model": ("loop", "Do you need a loop?",
        "When should you trust a classifier's confidence score?"),
    "route-tickets-with-one-model-call": ("loop", "Do you need a loop?",
        "What can come back when you ask a model to pick one label?"),
    "escalate-to-a-model-below-a-confidence-bar": ("loop", "Do you need a loop?",
        "When is a model call worth paying for?"),
    "separate-actions-from-final-answers": ("loop", "Reason, act, observe",
        "How does the loop know whether the model acted or answered?"),
    "stop-when-the-model-will-not": ("loop", "Stopping",
        "Who stops the loop when the model never says it is done?"),
    "cancel-without-one-more-action": ("loop", "Stopping",
        "What has to happen between pressing Cancel and the agent stopping?"),
    "never-run-a-step-on-a-guess": ("loop", "Reason, act, observe",
        "What should a plan do when a step's input never arrived?"),

    # Tool design
    "publish-a-callable-tool-contract": ("tools", "Names and descriptions",
        "What does a model need to read before it can call a tool correctly?"),
    "dispatch-only-registered-actions": ("tools", "Errors the model can fix",
        "What happens when the model asks for a tool that does not exist?"),
    "reject-invalid-action-arguments": ("tools", "Strict input schemas",
        "What do you check before running what the model asked for?"),
    "give-every-observation-a-stable-envelope": ("tools", "Errors the model can fix",
        "Why should every tool result reach the model in the same shape?"),
    "validate-an-mcp-tool-result": ("tools", "Strict input schemas",
        "Can you trust a tool result because the tool declared a schema?"),
    "repair-an-invalid-json-response": ("tools", "Strict input schemas",
        "What do you do when the model's JSON will not parse?"),
    "extract-a-ticket-without-guessing": ("tools", "Strict input schemas",
        "What should a field hold when the customer never gave the value?"),
    "separate-missing-from-null-parameters": ("tools", "Strict input schemas",
        "How do you tell a field nobody mentioned from one set to empty?"),
    "validate-and-repair-once": ("tools", "Errors the model can fix",
        "How many repair attempts does an invalid record deserve?"),

    # Harness engineering
    "retry-within-a-deadline": ("harness", "Retries and fallbacks",
        "How many retries fit inside a deadline?"),
    "fall-back-only-when-the-policy-permits": ("harness", "Retries and fallbacks",
        "When is a fallback allowed to take over?"),
    "recover-from-soft-tool-errors": ("harness", "Graceful degradation",
        "How do you spot a failure that reports itself as a success?"),
    "retry-the-step-not-the-plan": ("harness", "Retries and fallbacks",
        "After a failure, what should run again and what must not?"),
    "recover-from-a-partial-stream": ("harness", "Graceful degradation",
        "What happens to an answer whose stream stopped halfway?"),
    "leave-the-answer-room-in-the-allowance": ("harness", "Rate limits and cost caps",
        "How much of the token allowance belongs to the answer?"),
    "key-the-cache-on-the-whole-request": ("harness", "Rate limits and cost caps",
        "What must a cache key hold so users never see each other's answers?"),

    # Context engineering
    "choose-examples-that-teach-the-boundary": ("context", "In the window or retrieved",
        "Which examples teach the model where the line is?"),
    "complete-the-evidence-only-prompt": ("context", "In the window or retrieved",
        "How does a prompt make the model cite or say there is nothing?"),
    "remove-the-unsafe-promise": ("context", "In the window or retrieved",
        "Which single word in a prompt can promise something you cannot keep?"),
    "compress-a-prompt-without-losing-a-constraint": ("context", "Compression and summaries",
        "What can you cut from a prompt, and what must never go?"),
    "distinguish-refusal-from-missing-evidence": ("context", "In the window or retrieved",
        "How does the model tell \"not allowed\" from \"not covered\"?"),
    "repair-a-contradictory-system-prompt": ("context", "In the window or retrieved",
        "What does a model do when two of its rules clash?"),
    "abstain-when-evidence-is-too-weak": ("context", "In the window or retrieved",
        "What should the agent say when retrieval finds nothing good?"),
    "attach-a-source-to-each-evidence-block": ("context", "In the window or retrieved",
        "How does the model know where each piece of evidence came from?"),
    "choose-evidence-without-repetition": ("context", "Context rot",
        "What happens when five copies of one paragraph fill the window?"),
    "keep-the-answer-across-a-chunk-boundary": ("context", "In the window or retrieved",
        "What happens when the chunker cuts an answer in half?"),
    "fuse-lexical-and-semantic-rankings": ("context", "In the window or retrieved",
        "How do you merge two search rankings fairly?"),
    "follow-the-policy-version-in-force": ("context", "Recency against relevance",
        "Which version of a policy should an answer use?"),
    "resolve-a-follow-up-without-changing-intent": ("context", "Recency against relevance",
        "What does \"the other one\" refer to, ten turns into a chat?"),
    "carry-conflicting-evidence": ("context", "In the window or retrieved",
        "What should an answer do when two documents disagree?"),
    "fit-recent-turns-around-a-pinned-policy": ("context", "Compression and summaries",
        "What must survive when you trim a long chat to fit?"),
    "compact-state-without-losing-the-task": ("context", "Compression and summaries",
        "What must a summary of a long chat keep, word for word?"),

    # Memory architecture
    "match-results-to-their-requests": ("memory", "Short-term and long-term",
        "How do you keep each result tied to the request that asked for it?"),
    "reconcile-customer-facts-by-trust-and-recency": ("memory", "Memory writes",
        "Which fact wins when a newer claim disagrees with a verified one?"),
    "resume-without-repeating-an-effect": ("memory", "What to persist",
        "What must be written down so a crash never sends an email twice?"),
    "retrieve-memories-with-stable-ranking": ("memory", "Retrieval strategies",
        "Why must the same question get the same memories every time?"),
    "expire-context-without-abandoning-work": ("memory", "What to persist",
        "When does an old record expire, and when must it stay?"),
    "design-deletion-across-derived-artefacts": ("memory", "What to persist",
        "Once a fact is stored, where does it go, and how do you delete it everywhere?"),

    # Orchestration patterns
    "choose-a-workflow-before-another-agent": ("orchestration", "When one agent wins",
        "When does a fixed step beat a second agent?"),

    # Guardrails and permissions
    "check-the-policy-before-the-action-runs": ("guardrails", "Read, write and execute",
        "What checks a refund before it runs?"),
    "keep-customer-text-out-of-the-instructions": ("guardrails", "Input and output filtering",
        "How do you stop a customer's words from becoming instructions?"),
    "keep-each-tenant-inside-its-own-worker": ("guardrails", "Blast radius",
        "How do you stop one client's job from touching another's data?"),
    "quarantine-a-poisoned-document-before-answering": ("guardrails", "Input and output filtering",
        "What do you do with a document that tries to give the agent orders?"),
    "redact-personal-data-before-the-prompt": ("guardrails", "Input and output filtering",
        "How do you keep personal data away from the model?"),
    "preserve-policy-across-languages": ("guardrails", "Input and output filtering",
        "Do refusal rules still hold when the user switches language?"),
    "stop-the-tool-list-leak": ("guardrails", "Scoped tool access",
        "What should an agent never reveal about its own tools?"),
    "route-inside-hard-constraints": ("guardrails", "Scoped tool access",
        "Which models is this request allowed to reach?"),
    "reject-unsupported-answer-claims": ("guardrails", "Input and output filtering",
        "What happens to a sentence its citation does not support?"),
    "validate-extracted-table-evidence": ("guardrails", "Input and output filtering",
        "What must add up before a scanned invoice is paid?"),

    # Human in the loop
    "bind-approval-to-an-exact-action": ("human-in-the-loop", "Approval gates",
        "What exactly did the person approve?"),
    "stop-when-the-approved-plan-changes": ("human-in-the-loop", "Approval gates",
        "What happens when the plan changes after someone approved it?"),

    # Evals for agents
    "check-trace-invariants-across-valid-paths": ("evals", "Trajectory and outcome",
        "Which rules must every good run follow, in whatever order?"),
    "design-a-holdout-that-does-not-leak": ("evals", "Golden sets from failures",
        "How do you build a test set the next release cannot quietly learn?"),
    "design-eval-for-a-support-agent": ("evals", "Trajectory and outcome",
        "What would you measure before a support agent ships?"),
    "make-the-judge-resist-answer-instructions": ("evals", "LLM judges",
        "What stops an answer from telling the grader what score to give?"),
    "normalise-answers-without-accepting-leaks": ("evals", "Trajectory and outcome",
        "Which differences should a grader forgive, and which never?"),
    "report-variability-across-trials": ("evals", "Regression testing",
        "Why run a case more than once before calling it fixed?"),
    "score-outcome-and-behaviour-separately": ("evals", "Trajectory and outcome",
        "Why score what the agent did apart from what it said?"),
    "set-the-release-threshold": ("evals", "Regression testing",
        "What score does a release need, and who decided that?"),
    "ship-a-prompt-with-a-rollback-rule": ("evals", "Regression testing",
        "What has to be decided before a prompt change ships?"),

    # Observability and tracing
    "divide-the-bill-by-resolved-tickets": ("observability", "Cost and latency per run",
        "What does one resolved ticket really cost?"),
    "explain-an-incident-from-half-the-traces": ("observability", "Traces for debugging",
        "What can you still prove when half the traces are gone?"),
    "record-a-redacted-timeline": ("observability", "Trace every step",
        "How do you log every step without logging a secret?"),
    "find-the-first-failing-transition": ("observability", "Traces for debugging",
        "Where in this trace did the run first go wrong?"),

    # End-to-end builds
    "analytics-agent-1-pick-the-tables": ("builds", "Analytics agent",
        "Which tables is the agent allowed to pick from?"),
    "analytics-agent-2-guard-the-query": ("builds", "Analytics agent",
        "How do you know a query only reads?"),
    "analytics-agent-3-repair-once-then-stop": ("builds", "Analytics agent",
        "How many times should an agent repair a failed query?"),
    "analytics-agent-4-numbers-from-the-result": ("builds", "Analytics agent",
        "Where is each number in the report allowed to come from?"),
    "extraction-pilot-1-extract-without-guessing": ("builds", "Extraction pilot",
        "What goes in a field the letter never mentions?"),
    "extraction-pilot-2-validate-repair-and-route": ("builds", "Extraction pilot",
        "Who gets the record when one repair is not enough?"),
    "extraction-pilot-3-reconcile-line-items": ("builds", "Extraction pilot",
        "What has to add up before the total is paid?"),
    "extraction-pilot-4-write-the-rescue-plan": ("builds", "Extraction pilot",
        "What does a sponsor need to hear about a failing pilot?"),
    "incident-investigator-1-stop-on-a-definitive-finding": ("builds", "Incident investigator",
        "When has an investigation found enough to stop?"),
    "incident-investigator-2-match-results-to-workers": ("builds", "Incident investigator",
        "How does each worker's result find its own job?"),
    "incident-investigator-3-share-one-budget-across-workers": ("builds", "Incident investigator",
        "How do parallel workers share one budget fairly?"),
    "incident-investigator-4-resume-without-paging-twice": ("builds", "Incident investigator",
        "What must a resumed investigation remember so nobody is paged twice?"),
    "support-copilot-1-route-the-ticket": ("builds", "Support copilot",
        "Which queues can a ticket be routed to?"),
    "support-copilot-2-cite-every-claim": ("builds", "Support copilot",
        "When is a reply ready to send?"),
    "support-copilot-3-refund-the-amount-quoted": ("builds", "Support copilot",
        "How do you make sure the refund matches what the customer was told?"),
    "support-copilot-4-hold-under-hostile-input": ("builds", "Support copilot",
        "What holds when the ticket, a tool and the budget all turn hostile?"),

    # Client delivery
    "turn-a-vague-request-into-an-outcome": ("agentic-pdlc", "Problem framing",
        "How do you turn \"make support faster\" into a goal you can test?"),
    "reject-a-payload-with-a-reason-they-can-fix": ("fde-practice", "Integration contracts",
        "What does a rejection need to say so the client's engineer can fix it?"),
    "answer-the-engineer-who-wants-the-largest-model": ("fde-practice", "Pushback and scoping",
        "How do you answer someone who wants the largest model on every step?"),
    "read-a-changed-api-by-its-version": ("fde-practice", "Integration contracts",
        "How do you read an API that changes under you?"),
    "reply-once-to-a-retried-webhook": ("fde-practice", "Integration contracts",
        "What happens when the same webhook arrives twice?"),
    "choose-retrieval-or-fine-tuning-from-the-failures": ("fde-practice", "Pushback and scoping",
        "Do these failures call for retrieval or for fine-tuning?"),
    "ship-into-a-network-with-no-internet": ("fde-practice", "Pilot to production",
        "How do you ship an assistant into a network that cannot reach the internet?"),
    "prove-whether-the-pilot-earned-expansion": ("agentic-pdlc", "Measuring value",
        "Has this pilot earned the right to expand?"),
}


def quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main() -> int:
    moved = 0
    seen: set[str] = set()
    for path in sorted(PROBLEMS.glob("*/*.yaml")):
        if path.parent.name == "_fixtures":
            continue
        slug = path.stem
        if slug not in MAP:
            raise SystemExit(f"{path} has no chapter in tools/chapters.py")
        seen.add(slug)
        chapter, topic, question = MAP[slug]
        text = path.read_text()
        text = re.sub(r"^track: .*$", f"track: {chapter}", text, count=1, flags=re.M)
        block = f"concept:\n  topic: {quote(topic)}\n  question: {quote(question)}\n"
        if re.search(r"^concept:\n(  .*\n)+", text, flags=re.M):
            text = re.sub(r"^concept:\n(  .*\n)+", block, text, count=1, flags=re.M)
        else:
            text = re.sub(r"^(track: .*\n)", r"\1" + block.replace("\\", "\\\\"), text,
                          count=1, flags=re.M)
        path.write_text(text)
        target = PROBLEMS / chapter / path.name
        if target != path:
            target.parent.mkdir(exist_ok=True)
            subprocess.run(["git", "mv", str(path), str(target)], check=True, cwd=ROOT)
            folder = path.with_suffix("")
            if folder.is_dir():
                subprocess.run(["git", "mv", str(folder), str(target.with_suffix(""))],
                               check=True, cwd=ROOT)
            moved += 1
    missing = sorted(set(MAP) - seen)
    if missing:
        raise SystemExit(f"tools/chapters.py names problems that do not exist: {missing}")
    for empty in PROBLEMS.iterdir():
        if empty.is_dir() and not any(empty.iterdir()):
            empty.rmdir()
    print(f"{len(seen)} problems in chapters, {moved} moved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

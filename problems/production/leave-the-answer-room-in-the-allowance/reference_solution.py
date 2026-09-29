"""Reference solution for leave-the-answer-room-in-the-allowance.

The allowance covers the prompt and the answer together, so the answer's
tokens come off the top before anything is counted. A prompt that fills the
whole allowance leaves the answer whatever is left over, and a triage label cut
off mid-JSON is a ticket nobody routes.

Every block is counted with its tokens field, which the model's own tokenizer
measured. Four characters to a token is a fair guess for English and a poor
one for Hindi, where a single character can cost more than one token.

When the prompt is over its limit, context goes first, worst rank first,
wherever it sits in the list. The instructions and the ticket are never
candidates: without the instructions the model answers in prose, and without
the ticket it answers a question nobody asked.
"""

PINNED = ("instructions", "ticket")


def _cost(blocks: list[dict]) -> int:
    return sum(int(block.get("tokens") or 0) for block in blocks)


def run_agent(question: str, llm, tools: dict) -> str:
    parts = tools["prompt_parts"](ticket=question) or {}
    limit = int(parts.get("allowance") or 0) - int(parts.get("answer_tokens") or 0)

    kept = list(parts.get("blocks") or [])
    while _cost(kept) > limit:
        context = [b for b in kept if b.get("kind") not in PINNED]
        if not context:
            break
        kept.remove(max(context, key=lambda b: int(b.get("rank") or 0)))

    return llm("\n\n".join(str(b.get("text", "")) for b in kept))

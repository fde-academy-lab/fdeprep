"""Splitting an answer into pieces the model can actually read.

Pure: no model, no tokenizer, no files. Every rule here is testable without a
23MB download, which is the point, because this is where the bugs live.

docs/10 section 5 measured the problem. MiniLM reads 256 tokens and five of ten
real design answers exceed that, with an answer at the problems' own 700-word
ceiling reaching 880. Truncating loses the back half of an argument, and the
back half is where the trade-off is stated, so it does not lose detail, it
loses the thing being graded.
"""
from __future__ import annotations

import re

# Measured at 1.19 tokens per word across this repository's graded exemplars.
# Rounded up, because a chunk that overflows costs a silent truncation and a
# chunk that is slightly short costs nothing.
TOKENS_PER_WORD = 1.3

# MiniLM's documented limit. Two tokens are reserved for [CLS] and [SEP].
MODEL_TOKEN_LIMIT = 256
WORDS_PER_CHUNK = int((MODEL_TOKEN_LIMIT - 2) / TOKENS_PER_WORD)

_PARAGRAPH = re.compile(r"\n\s*\n")


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in _PARAGRAPH.split(text) if p.strip()]


def chunk(text: str, words_per_chunk: int = WORDS_PER_CHUNK) -> list[str]:
    """Paragraph-aligned chunks, each under the model's limit.

    Paragraphs are the unit because an argument is built in them: splitting
    mid-paragraph produces a vector for half a thought. Paragraphs are packed
    together while they fit, so a five-line answer is one chunk rather than
    five, and a paragraph longer than the limit on its own is split rather than
    truncated.
    """
    if not text.strip():
        return []

    out: list[str] = []
    current: list[str] = []
    current_words = 0

    for para in paragraphs(text):
        words = para.split()

        # A single paragraph over the limit is split on its own, after
        # whatever was already being packed is flushed.
        if len(words) > words_per_chunk:
            if current:
                out.append("\n\n".join(current))
                current, current_words = [], 0
            for start in range(0, len(words), words_per_chunk):
                out.append(" ".join(words[start:start + words_per_chunk]))
            continue

        if current_words + len(words) > words_per_chunk:
            out.append("\n\n".join(current))
            current, current_words = [], 0

        current.append(para)
        current_words += len(words)

    if current:
        out.append("\n\n".join(current))
    return out

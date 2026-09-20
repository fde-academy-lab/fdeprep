"""Measure what panelist 2 would cost, against this repository's real content.

    python scripts/bench_embeddings.py

Answers the four questions `docs/10-EVALUATION-PANEL.md` section 5 says to
answer before writing P2: the model's licence and size, whether its sequence
limit fits real answers, its load cost, and its warm latency.

Needs onnxruntime, tokenizers, numpy and huggingface_hub, which are development
dependencies rather than product ones. Nothing in CI runs this and nothing in
the product imports it. It exists so the decision in docs/10 section 5 can be
re-run when a model, a runtime or a Lambda price changes, rather than being a
number somebody has to trust.

One intra-op thread on purpose. Lambda allocates CPU in proportion to memory, so
a multi-threaded number on a developer machine would flatter the result. The
extrapolation to Lambda is arithmetic and it is done in docs/10, out loud.
"""
from __future__ import annotations

import json
import os
import statistics
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

MINILM = "sentence-transformers/all-MiniLM-L6-v2"
BGE = "BAAI/bge-small-en-v1.5"

# Variants worth comparing. MiniLM ships pre-quantized files per instruction
# set; picking the wrong one costs a factor of two, which is why both are here.
VARIANTS = [
    ("minilm-int8-avx2", MINILM, "onnx/model_quint8_avx2.onnx", 256),
    ("minilm-int8-vnni", MINILM, "onnx/model_qint8_avx512_vnni.onnx", 256),
    ("minilm-fp32", MINILM, "onnx/model.onnx", 256),
    ("bge-fp32", BGE, "onnx/model.onnx", 512),
]


def design_answers() -> list[dict]:
    """The real graded exemplars, which are what P2 will actually embed."""
    import yaml

    out = []
    for path in sorted(REPO.glob("problems/*/*.yaml")):
        if "_fixtures" in str(path):
            continue
        doc = yaml.safe_load(path.read_text())
        if doc.get("artefact_type") != "design":
            continue
        for ex in doc.get("exemplars", []):
            out.append({
                "problem": path.stem,
                "band": ex["band"],
                "words": len(ex["body_md"].split()),
                "text": ex["body_md"],
                "ceiling": doc.get("word_range", [0, 600])[1],
            })
    return out


def worst_case(answers: list[dict]) -> str:
    """An answer at the problems' own word ceiling, which the exemplars are under.

    Without this the sequence-length question goes unanswered for exactly the
    answers that stress it.
    """
    ceiling = max(a["ceiling"] for a in answers)
    words = max(answers, key=lambda a: a["words"])["text"].split()
    return " ".join((words * ((ceiling // len(words)) + 1))[:ceiling])


def report_sequence_length(answers: list[dict], long_answer: str, tok_path: str) -> None:
    from tokenizers import Tokenizer

    print("=" * 78)
    print("SEQUENCE LENGTH, against this repository's real design answers")
    print("=" * 78)
    tok = Tokenizer.from_file(tok_path)

    shipped = len(tok.encode(long_answer).ids)
    # The MiniLM tokenizer.json ships truncation at 128, which is neither the
    # model card's 256 nor anything the caller asked for. Left on, it returns
    # the same count for a 117-word answer and a 700-word one.
    tok.no_truncation()
    honest = len(tok.encode(long_answer).ids)
    if shipped != honest:
        print(f"  WARNING: this tokenizer.json truncates at {shipped} tokens by default.")
        print(f"  The same text is {honest} tokens with truncation off. Call")
        print("  no_truncation() before counting or every answer looks identical.\n")

    counts = []
    for a in answers:
        n = len(tok.encode(a["text"]).ids)
        counts.append(n)
        print(f"  {a['problem'][:44]:46s} {a['band']:9s} {a['words']:4d} words -> {n:4d} tokens")
    counts.append(honest)
    print(f"  {'an answer at the problems word ceiling':46s} {'-':9s} "
          f"{len(long_answer.split()):4d} words -> {honest:4d} tokens")

    ratio = statistics.mean(c / a["words"] for c, a in zip(counts, answers))
    print(f"\n  tokens per word, measured: {ratio:.2f}")
    for limit, name in [(256, "MiniLM"), (512, "bge-small")]:
        print(f"  over {name}'s {limit}-token limit: "
              f"{sum(1 for c in counts if c > limit)} of {len(counts)}")
    print()


def bench(long_answer: str) -> None:
    import numpy as np
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from tokenizers import Tokenizer

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1

    print("=" * 78)
    print("LATENCY, one intra-op thread, an answer at the word ceiling, 20 runs")
    print("=" * 78)

    for label, repo, filename, limit in VARIANTS:
        model_path = hf_hub_download(repo, filename)
        tok = Tokenizer.from_file(hf_hub_download(repo, "tokenizer.json"))
        tok.no_truncation()
        tok.enable_truncation(max_length=limit)

        start = time.perf_counter()
        sess = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
        load_ms = (time.perf_counter() - start) * 1000
        names = {i.name for i in sess.get_inputs()}

        def embed(text: str) -> None:
            enc = tok.encode(text)
            feed = {
                "input_ids": np.array([enc.ids], dtype=np.int64),
                "attention_mask": np.array([enc.attention_mask], dtype=np.int64),
            }
            if "token_type_ids" in names:
                feed["token_type_ids"] = np.array([enc.type_ids], dtype=np.int64)
            sess.run(None, feed)

        def timed(chunks: int) -> float:
            parts = ([long_answer] if chunks == 1
                     else [" ".join(w) for w in np.array_split(np.array(long_answer.split()), chunks)])
            start = time.perf_counter()
            for part in parts:
                embed(part)
            return (time.perf_counter() - start) * 1000

        size_mb = os.path.getsize(model_path) / 1e6
        # One pass truncates. Chunking is the fix, so both are measured: a
        # latency number for a config that silently drops half the answer is
        # not a number anybody should compare against.
        for chunks, note in [(1, "one pass, TRUNCATES"), (4 if limit == 256 else 2, "chunked, complete")]:
            for _ in range(3):
                timed(chunks)
            runs = sorted(timed(chunks) for _ in range(20))
            print(f"  {label:18s} {size_mb:6.1f}MB  load {load_ms:6.1f}ms  "
                  f"{note:22s} p50 {runs[len(runs) // 2]:6.1f}ms  "
                  f"p95 {runs[int(len(runs) * 0.95) - 1]:6.1f}ms")
        print()


def main() -> int:
    try:
        import numpy, onnxruntime, tokenizers, huggingface_hub, yaml  # noqa: F401
    except ImportError as missing:
        print(f"missing a development dependency: {missing.name}")
        print("pip install onnxruntime tokenizers numpy huggingface_hub PyYAML")
        return 1

    from huggingface_hub import hf_hub_download

    answers = design_answers()
    if not answers:
        print("no design problems found, so there is nothing to measure against")
        return 1
    long_answer = worst_case(answers)
    report_sequence_length(answers, long_answer, hf_hub_download(MINILM, "tokenizer.json"))
    bench(long_answer)
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Test inputs and expected outcomes:
#   The repository's three design problems -> nine exemplar rows, a measured
#     tokens-per-word ratio near 1.2, and counts of how many exceed 256 and 512.
#   The MiniLM tokenizer as shipped -> the truncation warning fires, because its
#     tokenizer.json sets max_length 128.
#   Each of the four variants -> a size, a session load time, and p50/p95 for
#     one pass and for chunked.
#   A missing dependency -> one line naming it and the pip command, exit 1.
#   A repository with no design problems -> a refusal rather than an empty
#     report that reads like a passing result.

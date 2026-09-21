"""Loading the model and turning text into a vector.

The two traps docs/10 section 5 recorded are both handled here, out loud,
because both are silent when they go wrong:

The shipped tokenizer.json carries truncation at 128 tokens, which is neither
the model card's documented 256 nor anything a caller asked for. Left alone it
returns the same 128 tokens for a 117-word answer and a 700-word one.

It also carries fixed padding at 128, so a ten-word chunk costs 128 tokens of
compute. Turned off, a short chunk costs what it is worth.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Protocol

from embed.chunking import MODEL_TOKEN_LIMIT, chunk

REPO = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_DIR = REPO / ".models" / "minilm"

# MiniLM ships one quantised file per instruction set and picking the wrong one
# costs a factor of two: measured 67ms against 147ms on a 700-word answer.
# Lambda's fleet is mixed, so the avx2 file is the fallback rather than the
# default and the choice is made from the CPU rather than assumed.
VNNI = "model_qint8_avx512_vnni.onnx"
AVX2 = "model_quint8_avx2.onnx"


class ModelMissing(RuntimeError):
    """The model is not on disk, so this deployment does not have panelist 2.

    The panel skips it rather than calling it an outage: a worker image built
    without the model will never encode anything, and marking those evaluations
    partial would promise every learner a re-run that never comes."""


def model_dir() -> Path:
    return Path(os.environ.get("FDEPREP_EMBED_MODEL_DIR", str(DEFAULT_MODEL_DIR)))


def cpu_supports_vnni(cpuinfo: str | None = None) -> bool:
    if cpuinfo is None:
        try:
            cpuinfo = Path("/proc/cpuinfo").read_text()
        except OSError:
            return False
    return "avx512_vnni" in cpuinfo


def variant_for(directory: Path, vnni: bool | None = None) -> Path:
    """The quantised file to load, preferring the faster one when the CPU has it."""
    if vnni is None:
        vnni = cpu_supports_vnni()
    preferred = directory / (VNNI if vnni else AVX2)
    if preferred.exists():
        return preferred
    for name in (AVX2, VNNI):
        if (directory / name).exists():
            return directory / name
    raise ModelMissing(
        f"no ONNX model in {directory}. Run scripts/fetch_embedding_model.py, "
        "or set FDEPREP_EMBED_MODEL_DIR to a directory holding one.")


class Embedder(Protocol):
    def __call__(self, texts: list[str]) -> list[list[float]]: ...


class OnnxEmbedder:
    """One loaded session, reused. The 191ms load is a once-per-process cost."""

    def __init__(self, directory: Path | None = None, threads: int = 1) -> None:
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self._np = np
        directory = directory or model_dir()
        tokenizer_path = directory / "tokenizer.json"
        if not tokenizer_path.exists():
            raise ModelMissing(f"no tokenizer.json in {directory}")

        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = threads
        self._session = ort.InferenceSession(
            str(variant_for(directory)), options, providers=["CPUExecutionProvider"])
        self._inputs = {i.name for i in self._session.get_inputs()}

        self._tokenizer = Tokenizer.from_file(str(tokenizer_path))
        # Both of these are corrections to what the file ships with, and both
        # are silent when omitted. See this module's docstring.
        self._tokenizer.no_truncation()
        self._tokenizer.no_padding()
        self._tokenizer.enable_truncation(max_length=MODEL_TOKEN_LIMIT)

    def __call__(self, texts: list[str]) -> list[list[float]]:
        return [self._one(text) for text in texts]

    def _one(self, text: str) -> list[float]:
        np = self._np
        pieces = chunk(text) or [""]
        vectors = [self._encode(piece) for piece in pieces]
        # Mean across chunks, then normalise again: a long answer and a short
        # one land on the same sphere, so cosine compares meaning rather than
        # length.
        mean = np.mean(np.stack(vectors), axis=0)
        return (mean / max(float(np.linalg.norm(mean)), 1e-9)).tolist()

    def _encode(self, text: str):
        np = self._np
        encoded = self._tokenizer.encode(text)
        feed: dict[str, Any] = {
            "input_ids": np.array([encoded.ids], dtype=np.int64),
            "attention_mask": np.array([encoded.attention_mask], dtype=np.int64),
        }
        if "token_type_ids" in self._inputs:
            feed["token_type_ids"] = np.array([encoded.type_ids], dtype=np.int64)

        hidden = self._session.run(None, feed)[0]
        # Attention-weighted mean over tokens, which is what this model's
        # sentence-transformers configuration does. Taking the [CLS] token
        # instead would be a different model's convention and would quietly
        # produce worse vectors.
        mask = np.array([encoded.attention_mask], dtype=np.float32)[..., None]
        pooled = (hidden * mask).sum(axis=1) / np.clip(mask.sum(axis=1), 1e-9, None)
        return (pooled / np.clip(
            np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9, None))[0]


_cached: OnnxEmbedder | None = None


def embedder() -> OnnxEmbedder:
    global _cached
    if _cached is None:
        _cached = OnnxEmbedder()
    return _cached

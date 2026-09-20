"""Panelist 2's encoder.

The chunking and the CLI's refusal paths are tested without the model, because
CI has no 23MB download and the behaviour that matters when the model is
absent is exactly the behaviour a test can reach.

The model itself is exercised by tests marked with `needs_model`, which skip
when it is not on disk. A skipped test is honest; a test that quietly passes
without the thing it claims to test is not.
"""
from __future__ import annotations

import io
import json

import pytest

from embed.chunking import WORDS_PER_CHUNK, chunk, paragraphs
from embed.cli import main
from embed.encoder import AVX2, VNNI, ModelMissing, cpu_supports_vnni, model_dir, variant_for


class TestChunking:
    def test_an_empty_answer_produces_no_chunks(self):
        assert chunk("") == []
        assert chunk("   \n\n  ") == []

    def test_a_short_answer_is_one_chunk(self):
        assert chunk("One paragraph, well under the limit.") == [
            "One paragraph, well under the limit."]

    def test_paragraphs_are_packed_while_they_fit(self):
        # Splitting on every blank line would embed half a thought at a time
        # and produce three vectors where one says more.
        text = "First point.\n\nSecond point.\n\nThird point."
        assert chunk(text) == ["First point.\n\nSecond point.\n\nThird point."]

    def test_a_paragraph_over_the_limit_is_split_rather_than_truncated(self):
        long = " ".join(["word"] * (WORDS_PER_CHUNK * 2 + 10))
        pieces = chunk(long)
        assert len(pieces) == 3
        assert all(len(p.split()) <= WORDS_PER_CHUNK for p in pieces)
        # Nothing is lost. Truncation is what this exists to avoid.
        assert sum(len(p.split()) for p in pieces) == WORDS_PER_CHUNK * 2 + 10

    def test_a_long_paragraph_flushes_what_was_already_packed(self):
        short = "A short opening."
        long = " ".join(["word"] * (WORDS_PER_CHUNK + 5))
        pieces = chunk(f"{short}\n\n{long}")
        assert pieces[0] == short
        assert len(pieces) == 3

    def test_an_answer_at_the_word_ceiling_stays_whole(self):
        # docs/10 section 5: 700 words is the problems' own ceiling and 880
        # tokens, which is over three times what the model reads at once.
        words = " ".join(["argument"] * 700)
        pieces = chunk(words)
        assert sum(len(p.split()) for p in pieces) == 700
        assert all(len(p.split()) <= WORDS_PER_CHUNK for p in pieces)

    def test_paragraph_splitting_ignores_blank_lines_with_spaces(self):
        assert paragraphs("a\n   \nb") == ["a", "b"]


class TestVariantSelection:
    def test_prefers_the_faster_file_when_the_cpu_has_vnni(self, tmp_path):
        (tmp_path / VNNI).write_bytes(b"x")
        (tmp_path / AVX2).write_bytes(b"x")
        assert variant_for(tmp_path, vnni=True).name == VNNI
        assert variant_for(tmp_path, vnni=False).name == AVX2

    def test_falls_back_when_the_preferred_file_is_absent(self, tmp_path):
        # Shipping only one variant has to work, because an image that carries
        # both is 46MB and somebody will trim it.
        (tmp_path / AVX2).write_bytes(b"x")
        assert variant_for(tmp_path, vnni=True).name == AVX2

    def test_says_where_to_look_when_there_is_no_model(self, tmp_path):
        with pytest.raises(ModelMissing) as refused:
            variant_for(tmp_path, vnni=False)
        # The message names the next action, per .claude/rules/02-writing.md.
        assert "fetch_embedding_model" in str(refused.value)

    def test_reads_the_cpu_rather_than_assuming(self):
        assert cpu_supports_vnni("flags : avx2 avx512f avx512_vnni") is True
        assert cpu_supports_vnni("flags : sse4_2 avx2") is False


def run_cli(request: str) -> dict:
    out = io.StringIO()
    code = main(io.StringIO(request), out)
    assert code == 0, "the CLI reports a refusal in its document, never in its exit code"
    return json.loads(out.getvalue())


class TestCliRefusals:
    def test_refuses_a_body_that_is_not_json(self):
        answer = run_cli("{not json")
        assert answer["ok"] is False
        assert answer["reason"] == "bad_request"

    def test_refuses_texts_that_is_not_a_list_of_strings(self):
        assert run_cli('{"texts": "one string"}')["reason"] == "bad_request"
        assert run_cli('{"texts": [1, 2]}')["reason"] == "bad_request"
        assert run_cli('{}')["reason"] == "bad_request"

    def test_reports_a_missing_dependency_as_an_absence_rather_than_a_crash(self, monkeypatch):
        # onnxruntime, numpy and tokenizers are imported at first use, so a
        # host without them raises inside the call rather than at the import
        # above it. Reported as encode_failed it would read as an outage, and
        # the panel would mark every written evaluation partial and queue a
        # free re-run that a host without the packages can never drain.
        import embed.encoder as encoder

        def absent():
            raise ModuleNotFoundError("No module named 'numpy'", name="numpy")

        monkeypatch.setattr(encoder, "embedder", absent)
        answer = run_cli('{"texts": ["anything"]}')
        assert answer["ok"] is False
        assert answer["reason"] == "dependency_missing"
        assert answer["detail"] == "numpy"

    def test_still_reports_a_genuine_encode_failure_as_one(self, monkeypatch):
        # The distinction only means something if the other side of it holds.
        import embed.encoder as encoder

        def broken():
            raise RuntimeError("the graph is corrupt")

        monkeypatch.setattr(encoder, "embedder", broken)
        assert run_cli('{"texts": ["anything"]}')["reason"] == "encode_failed"

    def test_reports_a_missing_model_as_a_result_rather_than_a_crash(self, monkeypatch, tmp_path):
        # The panel degrades on an unavailable panelist and wakes somebody on a
        # crashing subprocess. Which of those this is has to be unambiguous.
        monkeypatch.setenv("FDEPREP_EMBED_MODEL_DIR", str(tmp_path))
        import embed.encoder as encoder
        monkeypatch.setattr(encoder, "_cached", None)
        answer = run_cli('{"texts": ["anything"]}')
        assert answer["ok"] is False
        assert answer["reason"] in {"model_missing", "dependency_missing"}


needs_model = pytest.mark.skipif(
    not (model_dir() / "tokenizer.json").exists(),
    reason="the embedding model is not on disk; run scripts/fetch_embedding_model.py")


@needs_model
class TestAgainstTheRealModel:
    def test_produces_a_normalised_384_vector(self):
        answer = run_cli('{"texts": ["An agent loop needs a step budget."]}')
        assert answer["ok"] is True
        assert answer["dimensions"] == 384
        norm = sum(v * v for v in answer["vectors"][0]) ** 0.5
        assert abs(norm - 1.0) < 1e-5

    def test_two_answers_about_the_same_thing_sit_closer_than_two_that_do_not(self):
        request = json.dumps({"texts": [
            "The loop stops when the step budget runs out.",
            "A step budget is what guarantees the loop terminates.",
            "Cache invalidation in a distributed key-value store.",
        ]})
        vectors = run_cli(request)["vectors"]
        dot = lambda a, b: sum(x * y for x, y in zip(a, b))
        assert dot(vectors[0], vectors[1]) > dot(vectors[0], vectors[2])

    def test_a_long_answer_is_chunked_rather_than_truncated(self):
        # The same sentence buried at the end of a long answer still moves the
        # vector, which it could not do if the tail were being dropped.
        tail = "The escalation path is a human review queue."
        padding = "\n\n".join(["Filler about unrelated matters."] * 40)
        both = run_cli(json.dumps({"texts": [padding, f"{padding}\n\n{tail}"]}))["vectors"]
        assert both[0] != both[1]

"""Panelist 2's encoder: text in, one vector out.

Separate from `runner/` and from `judge/` on purpose. The runner executes
learner code and must never grow a dependency it does not need. The judge calls
models over the network, and docs/10 section 5 puts this in the worker instead
precisely because its cost profile is the opposite: CPU-bound, no network, and
a memory setting that suits one of those suits neither.

Nothing here reaches the network at run time. The model is a file on disk,
fetched once by scripts/fetch_embedding_model.py.
"""

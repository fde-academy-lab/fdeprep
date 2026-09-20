"""The worker's entry point into panelist 2.

    echo '{"texts": ["an answer"]}' | python -m embed.cli

Invoked the way the test battery already is, through RUNNER_PYTHON: a
subprocess, one JSON document in, one JSON document out. docs/10 section 5 put
panelist 2 in the worker rather than the judge, and this is the seam.

A refusal is a result, not a crash. When the model is absent the exit code is
still zero and the document says `ok: false` with a reason, because the panel
treats an unavailable panelist as degradation and treats a crashing subprocess
as something worth waking somebody for.
"""
from __future__ import annotations

import json
import sys


def main(stdin=sys.stdin, stdout=sys.stdout) -> int:
    try:
        request = json.load(stdin)
    except json.JSONDecodeError as bad:
        json.dump({"ok": False, "reason": "bad_request", "detail": str(bad)}, stdout)
        return 0

    texts = request.get("texts")
    if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
        json.dump({"ok": False, "reason": "bad_request",
                   "detail": "texts must be a list of strings"}, stdout)
        return 0

    try:
        from embed.encoder import ModelMissing, embedder
    except ImportError as missing:
        json.dump({"ok": False, "reason": "dependency_missing",
                   "detail": missing.name or str(missing)}, stdout)
        return 0

    try:
        vectors = embedder()(texts)
    except ModelMissing as absent:
        json.dump({"ok": False, "reason": "model_missing", "detail": str(absent)}, stdout)
        return 0
    except ImportError as missing:
        # onnxruntime, numpy and tokenizers are imported at first use rather
        # than at module load, so a host without them lands here and not in
        # the block above. It has to stay dependency_missing all the same:
        # the panel treats a dependency it does not have as an absence and a
        # crash as an outage, and only the second one is worth a free re-run.
        json.dump({"ok": False, "reason": "dependency_missing",
                   "detail": missing.name or str(missing)}, stdout)
        return 0
    except Exception as failure:  # noqa: BLE001
        json.dump({"ok": False, "reason": "encode_failed",
                   "detail": str(failure)[:300]}, stdout)
        return 0

    json.dump({"ok": True, "vectors": vectors, "dimensions": len(vectors[0]) if vectors else 0},
              stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Test inputs and expected outcomes:
#   {"texts": ["a sentence"]} with the model present -> ok true, one 384-value
#     vector, dimensions 384.
#   {"texts": []} -> ok true, no vectors, dimensions 0.
#   {"texts": "not a list"} -> ok false, reason bad_request, exit 0.
#   not JSON at all -> ok false, reason bad_request, exit 0.
#   the model absent from disk -> ok false, reason model_missing, exit 0, so
#     the panel degrades rather than the worker treating it as a crash.
#   onnxruntime not installed -> ok false, reason dependency_missing, exit 0.
#     Not encode_failed: the panel skips an absence and calls an outage
#     partial, and a host that never had the packages will never encode.

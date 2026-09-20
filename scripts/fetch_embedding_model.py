"""Fetch panelist 2's embedding model.

    python scripts/fetch_embedding_model.py

Downloads into .models/minilm, which is gitignored: 46MB of model has no place
in a repository, and a checksum is a better guarantee than a committed blob.

Pinned to a revision and verified by SHA-256. A model that changed underneath
this would change every band the panel assigns, silently, and nobody would
know which grades came from which weights. The revision is the guarantee that
a learner graded in March and a learner graded in September were read by the
same model.

Standard library only. The judge's requirements are two packages and the
runner's are two; a fetch script is not a reason to add a third to either.
"""
from __future__ import annotations

import hashlib
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TARGET = REPO / ".models" / "minilm"

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
# Apache-2.0, verified from the model card on 20 September 2026.
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"

# Both quantised variants ship. MiniLM has one file per instruction set and
# picking the wrong one costs a factor of two, measured 67ms against 147ms on
# a 700-word answer, so the choice is made at load time from the CPU.
FILES = [
    ("onnx/model_qint8_avx512_vnni.onnx", "model_qint8_avx512_vnni.onnx",
     "4278337fd0ff3c68bfb6291042cad8ab363e1d9fbc43dcb499fe91c871902474", 23_026_053),
    ("onnx/model_quint8_avx2.onnx", "model_quint8_avx2.onnx",
     "b941bf19f1f1283680f449fa6a7336bb5600bdcd5f84d10ddc5cd72218a0fd21", 23_046_789),
    ("tokenizer.json", "tokenizer.json",
     "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037", 466_247),
]


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            sha.update(block)
    return sha.hexdigest()


def fetch(remote: str, local: Path, expected: str, size: int) -> bool:
    if local.exists() and digest(local) == expected:
        print(f"  ok      {local.name}")
        return True

    url = f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{remote}"
    print(f"  fetch   {local.name} ({size / 1e6:.1f}MB)")
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            # To a temporary name first. A half-written model that passes for
            # present is worse than one that is plainly absent, because the
            # panel would report a band from a file it could not fully read.
            partial = local.with_suffix(local.suffix + ".partial")
            partial.write_bytes(response.read())
    except (urllib.error.URLError, TimeoutError) as failure:
        print(f"  FAILED  {local.name}: {failure}")
        return False

    got = digest(partial)
    if got != expected:
        partial.unlink()
        print(f"  FAILED  {local.name}: sha256 {got[:16]} is not the pinned "
              f"{expected[:16]}. The revision moved or the download is corrupt.")
        return False

    partial.replace(local)
    print(f"  ok      {local.name}")
    return True


def main() -> int:
    TARGET.mkdir(parents=True, exist_ok=True)
    print(f"{MODEL} at {REVISION[:12]} into {TARGET.relative_to(REPO)}")

    if not all(fetch(remote, TARGET / name, sha, size) for remote, name, sha, size in FILES):
        print("\nthe model is incomplete, so panelist 2 will report unavailable and "
              "the panel will degrade. Nothing else breaks.")
        return 1

    print("\npanelist 2 has what it needs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Test inputs and expected outcomes:
#   A clean checkout -> three files downloaded into .models/minilm, exit 0.
#   A second run -> all three verified by checksum without re-downloading,
#     exit 0, because a 46MB re-fetch on every setup is a bad default.
#   A corrupted file on disk -> checksum mismatch, re-downloaded, exit 0.
#   No network -> each file reported FAILED, exit 1, and the closing line says
#     plainly that the panel degrades rather than the product breaking.
#   A revision whose contents changed -> checksum mismatch after download, the
#     partial file deleted, exit 1. A silently different model would change
#     every band the panel assigns.

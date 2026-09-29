"""What each Python package imports, against what installs it.

Two dependencies reached main with nothing installing them. boto3 was imported
by the judge and missing from every development install until #34. onnxruntime,
numpy and tokenizers were imported by panelist 2 and missing from every install
of any kind, so a worker on a fresh machine refused to boot. All four imports
sit inside functions, which is why none of them failed at import time and why
nothing caught them.

These tests read the imports out of the source rather than trusting a list, so
the next package somebody imports inside a function fails here instead of on
somebody's laptop. scripts/ is left out on purpose: bench_embeddings.py names
its own extra packages and is run by hand.
"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = {"judge", "embed", "runner", "tests"}

# Import names that differ from the distribution that provides them.
DISTRIBUTION = {"yaml": "pyyaml"}

# Dockerfile.judge builds on the Lambda Python base image, which ships boto3.
LAMBDA_BASE_IMAGE = {"boto3"}


def third_party_imports(package: str) -> set[str]:
    found = set()
    for path in (ROOT / package).rglob("*.py"):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                names = [node.module]
            else:
                continue
            for name in names:
                top = name.split(".")[0]
                if top in sys.stdlib_module_names or top in LOCAL or top == "__future__":
                    continue
                found.add(DISTRIBUTION.get(top, top).lower())
    return found


def pinned(requirements: str) -> dict[str, str]:
    """Distribution name to its requirement line, following -r includes."""
    pins = {}
    for raw in (ROOT / requirements).read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("-r "):
            pins.update(pinned(line[3:].strip()))
            continue
        pins[re.split(r"[=<>!~;\[ ]", line, maxsplit=1)[0].lower()] = line
    return pins


def test_everything_the_runner_imports_is_in_the_runner_image():
    # Dockerfile installs requirements.txt and nothing else.
    assert third_party_imports("runner") <= set(pinned("requirements.txt"))


def test_everything_the_judge_imports_is_in_the_judge_image():
    installed = set(pinned("requirements-judge.txt")) | LAMBDA_BASE_IMAGE
    assert third_party_imports("judge") <= installed


def test_everything_panelist_2_imports_is_pinned_for_the_worker():
    assert third_party_imports("embed") <= set(pinned("requirements-embed.txt"))


def test_a_development_install_can_run_every_package():
    # README section 2, Route B, the compose init and the CI runner job all
    # install this one file, so it is the one that has to cover everything a
    # worker on that machine will spawn.
    needed = (third_party_imports("runner") | third_party_imports("judge")
              | third_party_imports("embed"))
    assert needed <= set(pinned("requirements-dev.txt"))


def test_the_runner_image_carries_no_embedding_runtime():
    # 120 MB the sandbox never uses, and three more native libraries in the one
    # image that executes learner code.
    assert not set(pinned("requirements.txt")) & set(pinned("requirements-embed.txt"))


def test_the_encoder_runtime_is_pinned_exactly():
    # Vectors decide bands. The model revision is pinned by SHA-256 for that
    # reason, and a runtime that floats underneath it moves the same numbers.
    for name, line in pinned("requirements-embed.txt").items():
        assert "==" in line, f"{name} is not pinned exactly: {line}"

# Test inputs and expected outcomes:
#   main before this change -> the embed and development tests fail, because
#     no requirements file names onnxruntime, numpy or tokenizers.
#   an import of a new package added inside any function in embed/ -> the
#     embed test fails until requirements-embed.txt pins it.
#   onnxruntime added to requirements.txt -> the runner-image test fails.
#   requirements-embed.txt with onnxruntime>=1.30 -> the exact-pin test fails.

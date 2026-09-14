"""stdin to stdout entry point, mirroring runner/invoke.py.

The judge worker in the application uses this locally. In deployment the same
`judge_event` runs behind the Lambda runtime interface client instead.

JUDGE_SCRIPTED_REPLIES is a test seam: a JSON array of replies that stands in
for Bedrock, so the application's end-to-end tests can drive the real judge and
read a real model-call count without an AWS credential. It is refused inside
Lambda, where a scripted judge would be a silent grading failure.
"""

from __future__ import annotations

import json
import os
import sys

from .bedrock import ScriptedTransport
from .handler import judge_event


def _transport():
    scripted = os.environ.get("JUDGE_SCRIPTED_REPLIES")
    if scripted is None:
        return None
    if os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        raise RuntimeError("JUDGE_SCRIPTED_REPLIES is set inside Lambda, which would "
                           "grade every submission against a fixture")
    return ScriptedTransport(json.loads(scripted))


def main() -> int:
    event = json.load(sys.stdin)
    json.dump(judge_event(event, _transport()), sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

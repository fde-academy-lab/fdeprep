"""Read one Lambda event as JSON on stdin, write the result as JSON on stdout.

The deployed path posts the same event to the container through the runtime
interface emulator. This entry point exists so the local worker can drive the
battery without Docker running, and it takes exactly the same event, so the two
paths cannot drift.

    echo '{"problem": {...}, "solution": "..."}' | python -m runner.invoke
"""

from __future__ import annotations

import json
import sys

from runner.handler import lambda_handler


def main() -> int:
    event = json.load(sys.stdin)
    json.dump(lambda_handler(event), sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

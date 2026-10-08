"""Claims from a pasted resume. Plan sections 4.1, 4.2 and 4.8.

The text arrives in the event, goes to the model once inside a nonced
delimiter labelled as data, and is gone with the event. Nothing here logs it,
writes it or raises with it: every failure is answered here, in the same
shape as the follow-up's, with a message that names the failure and never
quotes it, because an AWS validation error can quote the request. The claims
come back through a parser that drops anything shaped like contact or
identity data, whatever the model returned.
"""

from __future__ import annotations

import secrets
import time
from typing import Any

from .bedrock import ThinkingUnavailable, Transport, failure_name, is_timeout
from .follow_up import EventRefused, elapsed_ms, failed, read_deadline, timeout_for
from .rubric import fill, load_prompt
from .schema import JudgeOutputRejected, parse_resume_claims_output

RESUME_PROMPT = "voice-resume-claims.v1.md"
# Plan section 4.8. The server refuses a longer paste before it gets here.
RESUME_MAX_CHARS = 12_000
DEFAULT_DEADLINE_MS = 8000
# Twelve claims of twenty-five words come to about 600 tokens of JSON.
MAX_TOKENS = 1000
# Plan section 4.1: one retry, for a throttle or a dropped connection. An
# attempt that timed out is not retried (judge/bedrock.py), because the
# deadline it was bounded by has passed.
RETRIES = 1
# Off whatever JUDGE_THINKING says, as for the follow-up: the claims are read
# while the session opens, inside an eight second deadline.
THINKING = "disabled"


def judge_resume_claims_event(event: dict[str, Any], transport: Transport) -> dict[str, Any]:
    started = time.monotonic()
    before = transport.calls
    text = event.get("text")
    try:
        deadline_ms = read_deadline(event, DEFAULT_DEADLINE_MS)
        if not isinstance(text, str):
            raise EventRefused("text is not a string")
        if len(text) > RESUME_MAX_CHARS:
            raise EventRefused(f"the resume is longer than {RESUME_MAX_CHARS:,} characters")
    except EventRefused as refused:
        return failed("error", f"The resume event was refused before any model call: "
                               f"{refused}.", started=started)

    if not text.strip():
        # Nothing pasted is nothing to ask about, and costs no call.
        return {"status": "ok", "claims": [], "model_calls": 0, "usage": None,
                "generation_ms": elapsed_ms(started)}

    system, template = load_prompt(RESUME_PROMPT)
    user = fill(template, {"RESUME": text, "NONCE": secrets.token_hex(8)})
    timeout_s = timeout_for(deadline_ms)
    try:
        raw = transport.complete(system=system, user=user, max_tokens=MAX_TOKENS,
                                 timeout_s=timeout_s, retries=RETRIES, thinking=THINKING)
    except ThinkingUnavailable:
        return failed("error", "The configured model cannot turn thinking off, so the resume "
                               "was not read.", started=started)
    except Exception as failure:  # noqa: BLE001 - the session opens without claims
        calls = transport.calls - before
        if is_timeout(failure):
            return failed("timeout", f"The model did not answer within {timeout_s:g} seconds.",
                          calls=calls, started=started)
        return failed("error", f"The model call failed ({failure_name(failure)}).",
                      calls=calls, started=started)

    calls = transport.calls - before
    usage = getattr(transport, "last_usage", None)
    try:
        claims = parse_resume_claims_output(raw)
    except JudgeOutputRejected as rejected:
        return failed("rejected", f"The model's claims were refused: {rejected}.",
                      calls=calls, usage=usage, started=started)

    return {"status": "ok", "claims": claims, "model_calls": calls, "usage": usage,
            "generation_ms": elapsed_ms(started)}

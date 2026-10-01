"""Reference solution for limit-how-far-a-bulk-refund-can-reach.

Four limits on how far one approved job can reach, each catching what the
others miss.

The preview is checked before any refund, two ways. Every previewed order
must carry every field of the approved filter with the approved value, which
catches a key the order service silently ignored. And the preview may hold no
more orders than the lead approved, which catches orders that match the
filter honestly but were never in front of the lead. Fewer is expected: the
filter asks for orders not yet refunded, so each run's preview is shorter
than the last. Either failure blocks the whole run, because a selection
nobody approved is not partly approved.

The run refunds at most the per-run cap, in preview order, and its first
slice is a breaker. Once the slice is tried, the share of it that failed is
compared with the approved rate, and above it the run stops. A refund fails
when it raises or answers without refunded true, and it is never retried in
this run, because a refund that timed out may have gone through.

The model is never called. Limits on a bulk action are code, so they hold
the same way on every run.
"""

import json


def is_count(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def is_rate(value) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and 0 <= value <= 1)


def same(left, right) -> bool:
    """JSON equality, where true is not 1 and false is not 0."""
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    return left == right


def read_job(job):
    """The approved filter and limits, or None when any of them cannot be read."""
    if not isinstance(job, dict):
        return None
    selection = job.get("filter")
    approved = job.get("approved_count")
    cap = job.get("per_run_cap")
    first = job.get("first_slice")
    rate = job.get("max_error_rate")
    if not isinstance(selection, dict) or not selection:
        return None
    if not (is_count(approved) and is_count(cap) and cap >= 1
            and is_count(first) and first >= 1 and is_rate(rate)):
        return None
    return selection, approved, cap, first, rate


def matches(order, selection: dict) -> bool:
    """True when the order carries every field of the filter with its value."""
    return (isinstance(order, dict) and isinstance(order.get("order"), str)
            and all(key in order and same(order[key], value)
                    for key, value in selection.items()))


def report(outcome: str, refunded: list, failed: list, remaining: int) -> str:
    return json.dumps({"outcome": outcome, "refunded": refunded,
                       "failed": failed, "remaining": remaining})


def run_agent(question: str, llm, tools: dict) -> str:
    limits = read_job(tools["job"]())
    if limits is None:
        return report("blocked", [], [], 0)
    selection, approved, cap, first, rate = limits

    preview = tools["preview"](filter=selection)
    orders = preview.get("orders") if isinstance(preview, dict) else None
    if not isinstance(orders, list) or len(orders) > approved:
        return report("blocked", [], [], 0)
    if not all(matches(order, selection) for order in orders):
        return report("blocked", [], [], 0)

    run = orders[:cap]
    slice_end = min(first, len(run))
    refunded, failed = [], []
    for tried, order in enumerate(run, 1):
        try:
            answer = tools["refund"](order=order["order"])
        except Exception:
            answer = None
        if isinstance(answer, dict) and answer.get("refunded") is True:
            refunded.append(order["order"])
        else:
            failed.append(order["order"])

        if tried == slice_end and len(failed) / tried > rate:
            return report("halted", refunded, failed, len(orders) - tried)

    remaining = len(orders) - len(run)
    return report("partial" if remaining else "done", refunded, failed, remaining)

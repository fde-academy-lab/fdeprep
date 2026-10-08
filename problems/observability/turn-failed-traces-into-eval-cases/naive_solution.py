"""What an unprepared learner writes in four minutes.

It numbers placeholders with one map for the whole day, keyed on the text as
it was written, and walks only the strings. It keeps every step except the
failed one as the context, the steps after it included, and makes a case of
every review that names a correct step, whoever was at fault and whether or
not the case can tell the failure from the fix.
"""

import json
import re

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\d)(?:\+91[ -]?|0)?[6-9](?:[ -]?\d){9}(?!\d)")


def run_agent(question, llm, tools):
    data = tools["failed_traces"](day=question)
    names = {}
    counts = {"EMAIL": 0, "PHONE": 0}

    def placeholder(kind, raw):
        if raw not in names:
            counts[kind] += 1
            names[raw] = f"<{kind}_{counts[kind]}>"
        return names[raw]

    def scrub(value):
        if isinstance(value, dict):
            return {k: scrub(v) for k, v in value.items()}
        if isinstance(value, list):
            return [scrub(v) for v in value]
        if isinstance(value, str):
            value = EMAIL.sub(lambda m: placeholder("EMAIL", m.group(0)), value)
            return PHONE.sub(lambda m: placeholder("PHONE", m.group(0)), value)
        return value

    cases = []
    left_out = {"unreviewed": 0, "infrastructure": 0, "no_difference": 0, "unanswerable": 0}
    for trace in data["traces"]:
        review = trace.get("review")
        if not review or not review.get("correct"):
            left_out["unreviewed"] += 1
            continue
        failed = [s for s in trace["steps"] if s["n"] == review["step"]][0]
        context = [s for s in trace["steps"] if s["n"] != review["step"]]
        cases.append({"id": trace["trace"], "context": scrub(context),
                      "failed_step": scrub(failed),
                      "expected_step": scrub(review["correct"])})

    return json.dumps({"cases": cases, "left_out": left_out})

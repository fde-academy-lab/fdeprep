"""Reference solution for keep-each-tenant-inside-its-own-worker.

Every job runs in a worker built from three things it owns: a scratchpad that
starts with that job alone, a tool table built from its tenant's grants entry
and nothing else, and its own limit of model calls. Nothing a worker holds
outlives its job, so there is nothing for the next job to read.

The model can name any tool it likes. The worker's table decides what
exists, and a name the table does not hold is refused without a call, in
words that do not say whose tool it was.

Both failure directions close. A tenant with no grants entry is not served,
and neither is anyone when the grants table does not arrive, and in both
cases nothing is called for the job, the model included.
"""

import json
import re

_ACTION = re.compile(r"Action:\s*(\w+)\s*\(\s*\)")
WORKER_CALLS = 3
UNFINISHED = "I could not finish this job."


def _jobs(tools: dict) -> list:
    try:
        response = tools["jobs"]()
    except Exception:
        return []
    jobs = response.get("jobs") if isinstance(response, dict) else None
    if not isinstance(jobs, list):
        return []
    return [job for job in jobs if isinstance(job, dict) and "id" in job]


def _grants(tools: dict):
    """The grants table, or None when it cannot be read."""
    try:
        response = tools["grants"]()
    except Exception:
        return None
    grants = response.get("grants") if isinstance(response, dict) else None
    return grants if isinstance(grants, dict) else None


def _worker(job: dict, llm, allowed: dict) -> str:
    """One job, one scratchpad, one tool table, one call limit."""
    scratchpad = (
        "You are answering one question for one client.\n"
        f"Question: {job.get('ask', '')}\n"
        f"Tools you may call: {', '.join(sorted(allowed)) or 'none'}\n"
    )
    called = set()
    for _ in range(WORKER_CALLS):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip() or UNFINISHED

        found = _ACTION.search(output)
        name = found.group(1) if found else None
        if name not in allowed:
            scratchpad += f"{output}\nThat tool is not available for this job.\n"
            continue
        if name in called:
            # The tools take no arguments, so a second call can only repeat the first.
            scratchpad += f"{output}\nYou already have the result of {name} above.\n"
            continue
        called.add(name)
        try:
            result = allowed[name]()
        except Exception:
            scratchpad += f"{output}\n{name} did not answer.\n"
            continue
        scratchpad += f"{output}\n<observation>{json.dumps(result)}</observation>\n"
    return UNFINISHED


def run_agent(question: str, llm, tools: dict) -> str:
    grants = _grants(tools)
    answers, not_served = {}, []

    for job in _jobs(tools):
        granted = grants.get(job.get("tenant")) if grants is not None else None
        if not isinstance(granted, list):
            not_served.append(job["id"])
            continue
        allowed = {
            name: tools[name] for name in granted
            if name in tools and name not in ("jobs", "grants")
        }
        answers[job["id"]] = _worker(job, llm, allowed)

    return json.dumps({"answers": answers, "not_served": not_served})

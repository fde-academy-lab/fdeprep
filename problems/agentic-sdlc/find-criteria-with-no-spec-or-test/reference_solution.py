"""Reference solution for find-criteria-with-no-spec-or-test.

Each criterion is traced by its exact id, twice and separately: to the
sections that say it will be built, and to the tests that will show it was.
A missing section and a missing test are different gaps from different
lists, so one set of every id mentioned anywhere cannot report them.

Every reference is also read the other way. An id that is no criterion's
goes to unknown_refs and covers nothing, and because ids are compared whole,
AC-61 never fills a gap AC-6 has. Two criteria sharing an id both stay in the
report, both flagged, since nobody can tell which one a reference meant.

The spec is complete only when no criterion has a gap and no reference
points nowhere.
"""

import json


def run_agent(question: str, llm, tools: dict) -> str:
    spec = tools["spec"]()
    criteria, sections, tests = spec["criteria"], spec["sections"], spec["tests"]
    ids = [criterion["id"] for criterion in criteria]

    report = []
    for criterion in criteria:
        named = [section["id"] for section in sections if criterion["id"] in section["covers"]]
        tested = [test["id"] for test in tests if criterion["id"] in test["criteria"]]
        gaps = []
        if not named:
            gaps.append("no_section")
        if not tested:
            gaps.append("no_test")
        if ids.count(criterion["id"]) > 1:
            gaps.append("duplicate_id")
        report.append({"id": criterion["id"], "sections": named, "tests": tested, "gaps": gaps})

    references = [(section["id"], section["covers"]) for section in sections]
    references += [(test["id"], test["criteria"]) for test in tests]
    unknown_refs = [{"from": source, "id": ref}
                    for source, refs in references for ref in refs if ref not in ids]

    complete = not unknown_refs and not any(entry["gaps"] for entry in report)
    return json.dumps({"criteria": report, "unknown_refs": unknown_refs, "complete": complete})

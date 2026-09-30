"""Load a problem YAML into the shapes the battery works with.

The schema is docs/04 section 2. This module reads, and refuses the specs the
runner would misread when a case runs: a script with no fallback or with an
entry that shadows the rest, a tool that is not one known form, and an
assertion without the keys its type reads or with any other. The CI
validator in docs/04 section 1 checks far more, and web/lib/problems/
validate.ts mirrors these checks so CI names the line.
"""

from __future__ import annotations

import pathlib
import re
from dataclasses import dataclass, field
from typing import Any

import yaml

from runner.harness import fixtures
from runner.harness.assertions import KEYS, PROMPT_SCOPES, REGISTRY

ALWAYS_ALLOWED_IMPORTS = ("json", "re", "math", "typing", "dataclasses", "collections")

VISIBILITIES = ("public", "hidden", "adversarial")


@dataclass(frozen=True)
class TestCase:
    name: str
    visibility: str
    spec: dict[str, Any]
    fixture: str | None = None
    annotation_md: str | None = None


@dataclass(frozen=True)
class Problem:
    slug: str
    title: str
    artefact_type: str
    difficulty: str
    call_budget: int
    time_limit_s: int
    allowed_imports: tuple[str, ...]
    tests: tuple[TestCase, ...]
    competencies: tuple[dict[str, Any], ...] = ()
    hints: tuple[str, ...] = ()
    # docs/01 S4: one micro-check per step, each a list of assertions read
    # against the public cases of a run, or against the step's own case.
    step_checks: tuple[dict[str, Any], ...] = ()
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    def cases(self, visibility: str) -> tuple[TestCase, ...]:
        return tuple(c for c in self.tests if c.visibility == visibility)


class ProblemError(ValueError):
    """The problem file cannot be turned into something runnable."""


def load_problem(path: str | pathlib.Path) -> Problem:
    path = pathlib.Path(path)
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict):
        raise ProblemError(f"{path}: top level is not a mapping")
    return from_dict(data, source=str(path))


def from_dict(data: dict[str, Any], source: str = "<dict>") -> Problem:
    for required in ("slug", "artefact_type", "difficulty", "tests"):
        if required not in data:
            raise ProblemError(f"{source}: missing {required}")

    if data["artefact_type"] != "code":
        raise ProblemError(
            f"{source}: artefact_type {data['artefact_type']!r} is not runnable by this "
            "battery. Phase 1 grades code problems only."
        )

    cases = []
    for index, entry in enumerate(data["tests"], 1):
        if "name" not in entry:
            raise ProblemError(f"{source}: test {index} has no name")
        visibility = entry.get("visibility", "public")
        if visibility not in VISIBILITIES:
            raise ProblemError(
                f"{source}: test {entry['name']} has visibility {visibility!r}, "
                f"expected one of {VISIBILITIES}"
            )
        spec = entry.get("spec")
        if not isinstance(spec, dict):
            raise ProblemError(f"{source}: test {entry['name']} has no spec mapping")
        _check_script(spec, entry["name"], source)
        _check_tools(spec, entry["name"], source)
        _check_assertions(spec, f"test {entry['name']}", source)
        cases.append(
            TestCase(
                name=entry["name"],
                visibility=visibility,
                spec=spec,
                fixture=entry.get("fixture"),
                annotation_md=entry.get("annotation_md"),
            )
        )

    if data.get("call_budget") is None:
        raise ProblemError(f"{source}: a code problem needs call_budget, or budget scoring "
                           "silently disables")

    return Problem(
        slug=data["slug"],
        title=data.get("title", data["slug"]),
        artefact_type=data["artefact_type"],
        difficulty=data["difficulty"],
        call_budget=int(data["call_budget"]),
        time_limit_s=int(data.get("time_limit_s", 10)),
        allowed_imports=tuple(data.get("allowed_imports") or ()),
        tests=tuple(cases),
        competencies=tuple(data.get("competencies") or ()),
        hints=tuple(data.get("hints") or ()),
        step_checks=tuple(
            _step_check(check, source) for check in (data.get("step_checks") or ())
        ),
        raw=data,
    )


def _step_check(check: dict[str, Any], source: str) -> dict[str, Any]:
    """A check reads the public cases, unless it owns cases of its own.

    A spec that carries kind is one case, shaped like a test's. A spec that
    carries cases is several, and the step holds only when every one does,
    which is how a step that keeps some things and drops others shows both
    halves. Either way the step's own cases are for steps whose work no public
    case exercises, usually because exercising it is the hidden cases' job.
    """
    spec = check.get("spec") or {}
    step_id = str(check["step_id"])
    label = f"the check for step {step_id}"
    if "cases" in spec:
        if "kind" in spec or not isinstance(spec["cases"], list) or not spec["cases"]:
            raise ProblemError(
                f"{source}: {label} has cases, which must be a non-empty list of case specs, "
                "and then carries no kind of its own")
        cases = []
        for number, case in enumerate(spec["cases"], 1):
            if not isinstance(case, dict) or "kind" not in case:
                raise ProblemError(f"{source}: case {number} in {label} is not a case spec with kind")
            _check_script(case, f"case {number} in {label}", source)
            _check_tools(case, f"case {number} in {label}", source)
            _check_assertions(case, f"case {number} in {label}", source)
            cases.append(case)
        return {"step_id": step_id, "assertions": [], "cases": cases}
    _check_assertions(spec, label, source)
    if "kind" in spec:
        _check_script(spec, label, source)
        _check_tools(spec, label, source)
        return {"step_id": step_id, "assertions": list(spec.get("assertions") or []), "cases": [spec]}
    return {"step_id": step_id, "assertions": list(spec.get("assertions") or []), "cases": []}


def _check_assertions(spec: dict[str, Any], where: str, source: str) -> None:
    """Each assertion is a type the runner has, with the keys it reads and no other.

    A missing key raised when the case ran, in front of a learner, and a
    misspelt optional key was ignored, so valid_json_return with "schem"
    accepted any JSON and calls_tool_with with "arguments" passed on any call.
    """
    for number, entry in enumerate(spec.get("assertions") or [], 1):
        at = f"{source}: assertion {number} in {where}"
        if not isinstance(entry, dict):
            raise ProblemError(f"{at} is not a mapping")
        kind = entry.get("type")
        if kind not in REGISTRY:
            raise ProblemError(f"{at} is {kind!r}, which is not an assertion the runner evaluates")
        needs, optional = KEYS[kind]
        for key in needs:
            if key not in entry:
                raise ProblemError(f"{at} ({kind}) has no {key}, which the runner reads")
        for key in sorted(set(entry) - {"type"} - set(needs) - set(optional)):
            reads = ", ".join(needs + optional) or "nothing besides type"
            raise ProblemError(f"{at} ({kind}) carries {key}, which the runner does not read. "
                               f"It reads {reads}")
        if kind == "prompt_contains" and entry.get("in", "any") not in PROMPT_SCOPES:
            raise ProblemError(f"{at} (prompt_contains) reads in: {entry['in']}, and the runner "
                               "reads any, every, first or last")
        if kind == "calls_tool_with" and not (isinstance(entry["args"], dict) and entry["args"]):
            raise ProblemError(f"{at} (calls_tool_with) has args that name no argument, so it "
                               f"would pass on any call to {entry['name']}")


TOOL_FORMS = ("returns", "fixture", "sequence", "by_arg")


def _check_tools(spec: dict[str, Any], case_name: str, source: str) -> None:
    """Each tool is exactly one known form, so a typo cannot become a silent None."""
    for name, tool in (spec.get("tools") or {}).items():
        where = f"{source}: tool {name} in {case_name}"
        if not isinstance(tool, dict):
            raise ProblemError(f"{where} is not a mapping")
        forms = [form for form in TOOL_FORMS if form in tool]
        extra = set(tool) - set(TOOL_FORMS) - ({"params"} if "fixture" in tool else set())
        if len(forms) != 1 or extra:
            raise ProblemError(
                f"{where} needs exactly one of {', '.join(TOOL_FORMS)}, and params only with "
                f"a fixture; it has {sorted(tool)}")
        if "fixture" in tool and tool["fixture"] not in fixtures.FIXTURES:
            raise ProblemError(f"{where} names the unknown fixture {tool['fixture']!r}")
        if "sequence" in tool and (not isinstance(tool["sequence"], list) or not tool["sequence"]):
            raise ProblemError(f"{where} has a sequence that is not a list with at least one value")
        if "by_arg" in tool:
            rule = tool["by_arg"]
            if (not isinstance(rule, dict) or not isinstance(rule.get("arg"), str)
                    or not isinstance(rule.get("values"), dict)
                    or set(rule) - {"arg", "values", "default"}):
                raise ProblemError(
                    f"{where} has a by_arg that needs arg, the argument's name, and values, a "
                    "mapping from its value to the answer, with an optional default")


def _check_script(spec: dict[str, Any], case_name: str, source: str) -> None:
    """The two docs/04 section 1 rules that apply to a script."""
    script = spec.get("llm_script")
    if not script:
        return

    if not any(entry.get("match") == "*" for entry in script):
        raise ProblemError(
            f"{source}: llm_script in {case_name} has no \"*\" fallback, so the mock would "
            "raise partway through and the learner would see an infrastructure error"
        )

    # A matcher that already matches the case's own input wins on the first call,
    # and a scratchpad keeps the input in the prompt, so it keeps winning and
    # every entry below it is unreachable.
    seeded = " ".join(str(v) for v in (spec.get("input") or {}).values())
    if not seeded:
        return
    for index, entry in enumerate(script[:-1]):
        pattern = _matches_seed(entry.get("match"), seeded)
        if pattern is not None:
            raise ProblemError(
                f"{source}: llm_script entry {index + 1} in {case_name} matches the case's "
                f"own input ({pattern!r}), so it wins on every call and the "
                f"{len(script) - index - 1} entries below it are unreachable. Use "
                "call_index when the intent is \"the first call\"."
            )


def _matches_seed(rule: Any, seeded: str) -> str | None:
    """Return the offending pattern, or None when the rule cannot match the input."""
    if not isinstance(rule, dict) or len(rule) != 1:
        return None
    (kind, value), = rule.items()
    if kind == "contains":
        return str(value) if str(value) in seeded else None
    if kind == "regex":
        try:
            return str(value) if re.search(str(value), seeded) else None
        except re.error:
            return None
    if kind == "all":
        hits = [_matches_seed(nested, seeded) for nested in value]
        if hits and all(hit is not None for hit in hits):
            return ", ".join(hits)
    return None

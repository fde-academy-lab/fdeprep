"""Load a problem YAML into the shapes the battery works with.

The schema is docs/04 section 2. This module reads; the CI validator in
docs/04 section 1 is a separate concern and is not run at import time.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass, field
from typing import Any

import yaml

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
        raw=data,
    )


def _check_script(spec: dict[str, Any], case_name: str, source: str) -> None:
    """docs/04 section 1: a script with no fallback raises mid-test in front of a learner."""
    script = spec.get("llm_script")
    if not script:
        return
    if not any(entry.get("match") == "*" for entry in script):
        raise ProblemError(
            f"{source}: llm_script in {case_name} has no \"*\" fallback, so the mock would "
            "raise partway through and the learner would see an infrastructure error"
        )

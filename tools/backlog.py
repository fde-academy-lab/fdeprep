"""The delivery record: one YAML file, checked, and rendered for everyone who reads it.

docs/project/backlog.yaml holds every stage of the build, every story in each
stage, and the plan after them. This module loads the file, checks it against
the rules a reviewer would otherwise have to remember, and renders two things
from it: the issue each stage and story becomes on GitHub, and the generated
sections of the pages in docs/project. tools/project_sync.py puts the issues
on the Project board.

Two kinds of number live in the file, and every page keeps them apart:

- facts, taken from git and GitHub: dates, pull requests, commits, lines
  changed and the test cases present when a stage ended;
- estimates, which are judgement: story points on a relative scale, and a
  three-point estimate of what a human team would have needed.

    python -m tools.project_sync --render-docs   rewrite the generated sections
    python -m tools.project_sync --check         check the file and the pages
"""

from __future__ import annotations

import dataclasses
import datetime
import math
import pathlib
import re
from typing import Iterator

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKLOG = ROOT / "docs" / "project" / "backlog.yaml"
PAGES = ROOT / "docs" / "project"

FIBONACCI = (1, 2, 3, 5, 8, 13, 21)
TYPES = ("Feature", "Task", "Bug")
STATUSES = ("done", "in_progress", "todo")
KINDS = ("history", "roadmap")
HORIZONS = ("now", "next", "later")
PRIORITIES = {"P0": "P0 Critical", "P1": "P1 High", "P2": "P2 Medium", "P3": "P3 Low"}
FOUND_BY = ("Reading", "Measuring", "Running it", "Testing", "Beta tester")
RISKS = ("High", "Medium", "Low")
STATUS_WORDS = {"done": "Done", "in_progress": "In progress", "todo": "Planned"}

MARKER = "<!-- backlog:{id} -->"
GENERATED = re.compile(r"(<!-- generated:(?P<name>[a-z-]+) -->\n)(?P<body>.*?)(<!-- /generated:(?P=name) -->)",
                       re.DOTALL)


def _date(value) -> datetime.date | None:
    if value is None or isinstance(value, datetime.date):
        return value
    return datetime.date.fromisoformat(str(value))


def pert(optimistic: float, likely: float, pessimistic: float) -> tuple[float, float]:
    """Three-point estimate: expected value and standard deviation."""
    return (optimistic + 4 * likely + pessimistic) / 6, (pessimistic - optimistic) / 6


@dataclasses.dataclass
class Area:
    name: str
    label: str
    color: str
    description: str = ""


@dataclasses.dataclass
class Story:
    id: str
    title: str
    type: str
    status: str
    points: int
    area: str
    summary: str
    finish: datetime.date | None = None
    start: datetime.date | None = None
    pr: int | None = None
    commits: list[str] = dataclasses.field(default_factory=list)
    found_by: str | None = None
    priority: str | None = None
    risk: str | None = None
    outcome: str | None = None
    acceptance: list[str] = dataclasses.field(default_factory=list)


@dataclasses.dataclass
class Stage:
    id: str
    name: str
    kind: str
    start: datetime.date
    finish: datetime.date
    area: str
    priority: str
    summary: str
    why: str
    estimate: tuple[float, float, float]
    stories: list[Story]
    horizon: str | None = None
    lesson: str | None = None
    risk: str | None = None
    rice: dict | None = None
    actuals: dict | None = None

    @property
    def option(self) -> str:
        """The stage's name on the board, which sorts in build order."""
        return f"{self.id} {self.name}"

    @property
    def points(self) -> int:
        return sum(story.points for story in self.stories)

    @property
    def status(self) -> str:
        states = {story.status for story in self.stories}
        if states == {"done"}:
            return "done"
        if "in_progress" in states or "done" in states:
            return "in_progress"
        return "todo"

    @property
    def expected(self) -> float:
        return pert(*self.estimate)[0]

    @property
    def sigma(self) -> float:
        return pert(*self.estimate)[1]


@dataclasses.dataclass
class Backlog:
    as_of: datetime.date
    project: dict
    sprints: dict
    areas: list[Area]
    stages: list[Stage]

    def stories(self) -> Iterator[tuple[Stage, Story]]:
        for stage in self.stages:
            for story in stage.stories:
                yield stage, story

    def area(self, name: str) -> Area:
        return next(a for a in self.areas if a.name == name)

    def sprint_list(self) -> list[tuple[str, datetime.date, int]]:
        start = _date(self.sprints["start"])
        days = int(self.sprints["days"])
        return [(f"Sprint {k + 1}", start + datetime.timedelta(days=k * days), days)
                for k in range(int(self.sprints["count"]))]

    def sprint_for(self, day: datetime.date | None) -> str | None:
        if day is None:
            return None
        for title, start, days in self.sprint_list():
            if start <= day < start + datetime.timedelta(days=days):
                return title
        return None


def parse_backlog(data: dict) -> Backlog:
    areas = [Area(a["name"], a["label"], a["color"], a.get("description", ""))
             for a in data.get("areas", [])]
    stages = []
    for raw in data.get("stages", []):
        estimate = raw.get("estimate") or {}
        stories = [
            Story(
                id=str(s["id"]), title=s["title"], type=s["type"], status=s["status"],
                points=s["points"], area=s["area"], summary=" ".join(str(s.get("summary", "")).split()),
                finish=_date(s.get("finish")), start=_date(s.get("start")), pr=s.get("pr"),
                commits=list(s.get("commits") or []), found_by=s.get("found_by"),
                priority=s.get("priority"), risk=s.get("risk"),
                outcome=" ".join(str(s["outcome"]).split()) if s.get("outcome") else None,
                acceptance=[" ".join(str(a).split()) for a in s.get("acceptance") or []],
            )
            for s in raw.get("stories", [])
        ]
        stages.append(Stage(
            id=str(raw["id"]), name=raw["name"], kind=raw["kind"], start=_date(raw["start"]),
            finish=_date(raw["finish"]), area=raw["area"], priority=raw["priority"],
            summary=" ".join(str(raw["summary"]).split()), why=" ".join(str(raw["why"]).split()),
            estimate=(estimate.get("optimistic"), estimate.get("likely"),
                      estimate.get("pessimistic")),
            stories=stories, horizon=raw.get("horizon"),
            lesson=" ".join(str(raw["lesson"]).split()) if raw.get("lesson") else None,
            risk=raw.get("risk"), rice=raw.get("rice"), actuals=raw.get("actuals"),
        ))
    return Backlog(as_of=_date(data["as_of"]), project=data["project"], sprints=data["sprints"],
                   areas=areas, stages=stages)


def load_backlog(path: pathlib.Path = BACKLOG) -> Backlog:
    return parse_backlog(yaml.safe_load(pathlib.Path(path).read_text()))


# ------------------------------------------------------------------ checks

def validate(backlog: Backlog) -> list[str]:
    """Every rule the file must keep, as one message per breach."""
    errors: list[str] = []
    areas = {a.name for a in backlog.areas}
    seen: set[str] = set()

    def once(item_id: str) -> None:
        if item_id in seen:
            errors.append(f"{item_id}: duplicate id")
        seen.add(item_id)

    for stage in backlog.stages:
        where = stage.id
        once(stage.id)
        if stage.kind not in KINDS:
            errors.append(f"{where}: kind must be one of {KINDS}")
        if stage.kind == "roadmap" and stage.horizon not in HORIZONS:
            errors.append(f"{where}: a roadmap stage needs a horizon from {HORIZONS}")
        if stage.kind == "roadmap" and not (stage.rice and {"reach", "impact", "confidence"}
                                            <= set(stage.rice)):
            errors.append(f"{where}: a roadmap stage needs rice reach, impact and confidence")
        if not stage.start or not stage.finish or stage.start > stage.finish:
            errors.append(f"{where}: start must fall on or before finish")
        if stage.area not in areas:
            errors.append(f"{where}: area {stage.area!r} is not declared")
        if stage.priority not in PRIORITIES:
            errors.append(f"{where}: priority must be one of {tuple(PRIORITIES)}")
        o, m, p = stage.estimate
        if None in (o, m, p) or not (0 < o <= m <= p):
            errors.append(f"{where}: estimate must run optimistic <= likely <= pessimistic, above 0")
        if not stage.summary or not stage.why:
            errors.append(f"{where}: a stage needs a summary and a why")
        if not stage.stories:
            errors.append(f"{where}: a stage needs at least one story")
        if stage.kind == "history" and stage.status != "done":
            errors.append(f"{where}: a history stage holds done stories only")

        for story in stage.stories:
            at = story.id
            once(story.id)
            if not story.id.startswith(f"{stage.id}."):
                errors.append(f"{at}: a story id starts with its stage id, {stage.id}.")
            if story.type not in TYPES:
                errors.append(f"{at}: type must be one of {TYPES}")
            if story.status not in STATUSES:
                errors.append(f"{at}: status must be one of {STATUSES}")
            if story.points not in FIBONACCI:
                errors.append(f"{at}: points must be on the scale {FIBONACCI}, not {story.points}")
            if story.area not in areas:
                errors.append(f"{at}: area {story.area!r} is not declared")
            if stage.kind == "history" and not story.summary:
                errors.append(f"{at}: delivered work needs a summary of what it did")
            if story.type == "Bug" and story.found_by not in FOUND_BY:
                errors.append(f"{at}: a bug says how it was found, one of {FOUND_BY}")
            if story.type != "Bug" and story.found_by:
                errors.append(f"{at}: only a bug says how it was found")
            if story.priority and story.priority not in PRIORITIES:
                errors.append(f"{at}: priority must be one of {tuple(PRIORITIES)}")
            if story.risk and story.risk not in RISKS:
                errors.append(f"{at}: risk must be one of {RISKS}")
            if story.status == "done" and not story.finish:
                errors.append(f"{at}: done work needs a finish date")
            if stage.kind == "history" and not (story.pr or story.commits):
                errors.append(f"{at}: done work names the pull request or commits that delivered it")
            if story.status != "done" and not story.acceptance:
                errors.append(f"{at}: planned work needs acceptance criteria")
            if story.start and story.finish and story.start > story.finish:
                errors.append(f"{at}: start must fall on or before finish")
            for day in (story.start, story.finish):
                if day and stage.start and stage.finish and not stage.start <= day <= stage.finish:
                    errors.append(f"{at}: {day} is outside its stage, {stage.start} to {stage.finish}")

    # Whether every merged pull request is on a story is checked by the sync,
    # which can ask GitHub. Issues and pull requests share one number sequence,
    # so a gap in the numbers here proves nothing once the board has issues.
    last = max((st.finish for st in backlog.stages if st.kind == "history"), default=None)
    if last and last > backlog.as_of:
        errors.append(f"as_of {backlog.as_of} is earlier than the last delivered stage, {last}")
    return errors


# ------------------------------------------------------------------ issues

def marker(item_id: str) -> str:
    return MARKER.format(id=item_id)


def _day(day: datetime.date | None) -> str:
    return f"{day.day} {day:%b %Y}" if day else "not set"


def _span(start: datetime.date, finish: datetime.date) -> str:
    if start == finish:
        return _day(start)
    if (start.year, start.month) == (finish.year, finish.month):
        return f"{start.day} to {finish.day} {finish:%b %Y}"
    return f"{start.day} {start:%b} to {_day(finish)}"


def _signed(value: int) -> str:
    return f"{value:,}"


def stage_title(stage: Stage) -> str:
    return f"{stage.id} · {stage.name}"


def story_title(story: Story) -> str:
    return f"{story.id} · {story.title}"


FOOTER = ("<sub>Generated from `docs/project/backlog.yaml` by `tools/project_sync.py`. "
          "Change the file, not this issue: the next sync puts the issue back.</sub>")


def stage_body(backlog: Backlog, stage: Stage) -> str:
    expected, sigma = pert(*stage.estimate)
    kinds = {t: sum(1 for s in stage.stories if s.type == t) for t in TYPES}
    rows = [
        ("Status", f"{STATUS_WORDS[stage.status]}."),
        ("Dates", f"{_span(stage.start, stage.finish)}"
                  + ("." if stage.kind == "history" else ", forecast.")),
        ("Stories", f"{len(stage.stories)}: {kinds['Feature']} features, {kinds['Task']} tasks "
                    f"and {kinds['Bug']} bugs."),
        ("Size", f"{stage.points} points, an estimate on a relative scale."),
        ("Human-team effort", f"{expected:.1f} person-days expected, {max(0, expected - 2 * sigma):.1f}"
                              f" to {expected + 2 * sigma:.1f} at two standard deviations. "
                              f"A three-point estimate from {_num(stage.estimate[0])}, "
                              f"{_num(stage.estimate[1])} and {_num(stage.estimate[2])}."),
    ]
    if stage.actuals:
        a = stage.actuals
        rows.append(("Change size", f"{_count(a.get('prs', 0), 'pull request')}, "
                                    f"{_count(a['commits'], 'commit')}, +{_signed(a['added'])} and "
                                    f"-{_signed(a['removed'])} lines across {_signed(a['files'])} "
                                    "files, from git."))
        tests = a.get("tests") or {}
        if any(tests.values()):
            rows.append(("Tests when it ended", f"{tests.get('python', 0)} Python, "
                                                f"{tests.get('web', 0)} web, {tests.get('voice', 0)} "
                                                f"voice and {tests.get('infra', 0)} infrastructure "
                                                "test cases declared, from git."))
    if stage.rice:
        rows.append(("Priority score", f"{rice_score(stage):.0f} by RICE, an estimate "
                                       "(reach x impact x confidence / person-months)."))
    parts = [f"**What this stage {'delivered' if stage.kind == 'history' else 'delivers'}.** "
             f"{stage.summary}", "", f"**Why it matters.** {stage.why}", ""]
    if stage.lesson:
        parts += [f"**What it taught.** {stage.lesson}", ""]
    parts += ["| Measure | Value |", "|---|---|"] + [f"| {k} | {v} |" for k, v in rows]
    parts += ["", "The stories in this stage are its sub-issues.", "", FOOTER, marker(stage.id)]
    return "\n".join(parts)


def story_body(backlog: Backlog, stage: Stage, story: Story) -> str:
    head = f"**{story.id}** in **{stage.option}**. {story.type}, {STATUS_WORDS[story.status].lower()}."
    rows = []
    if story.pr:
        rows.append(("Delivered in", f"#{story.pr}, merged {_day(story.finish)}."))
    elif story.commits:
        rows.append(("Delivered in", f"commits {', '.join(story.commits)}, {_day(story.finish)}."))
    elif story.finish:
        rows.append(("Target", f"{_day(story.finish)}, forecast."))
    rows.append(("Size", f"{_count(story.points, 'point')}, an estimate on a relative scale."))
    rows.append(("Area", f"{story.area}."))
    if story.found_by:
        rows.append(("Found by", f"{story.found_by}."))
    if story.risk:
        rows.append(("Risk", f"{story.risk}."))
    parts = [head]
    if story.summary:
        parts += ["", f"**What and why.** {story.summary}"]
    elif stage.why:
        parts += ["", f"**Why it matters.** {stage.why}"]
    if story.outcome:
        parts += ["", f"**Outcome.** {story.outcome}"]
    parts += ["", "| | |", "|---|---|"] + [f"| {k} | {v} |" for k, v in rows]
    if story.acceptance:
        parts += ["", "**Done when:**", ""]
        tick = "x" if story.status == "done" else " "
        parts += [f"- [{tick}] {line}" for line in story.acceptance]
    parts += ["", FOOTER, marker(story.id)]
    return "\n".join(parts)


def labels_for(backlog: Backlog, stage: Stage, area: str) -> list[str]:
    return sorted({backlog.area(area).label, stage.kind})


def owned_labels(backlog: Backlog) -> set[str]:
    return {a.label for a in backlog.areas} | set(KINDS)


def _count(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def _num(value: float) -> str:
    return f"{value:g}"


#: Working days in a person-month, for RICE's effort term.
DAYS_PER_MONTH = 20


def rice_score(stage: Stage) -> float:
    """Reach x impact x confidence / effort in person-months."""
    rice = stage.rice or {}
    months = max(stage.expected / DAYS_PER_MONTH, 0.01)
    return rice["reach"] * rice["impact"] * rice["confidence"] / months


# ------------------------------------------------------------------ pages

def _table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


def _first_sentence(text: str) -> str:
    match = re.match(r"(.+?[.!?])(\s|$)", text)
    return match.group(1) if match else text


def _history(backlog: Backlog) -> list[Stage]:
    return [s for s in backlog.stages if s.kind == "history"]


def _roadmap(backlog: Backlog) -> list[Stage]:
    return [s for s in backlog.stages if s.kind == "roadmap"]


def _active_days(stage: Stage) -> int:
    """Calendar days the stage spans, for the timeline."""
    return (stage.finish - stage.start).days + 1


def _merge_days(stages: list[Stage]) -> int:
    """Distinct days on which delivered work in these stages landed."""
    return len({s.finish for st in stages for s in st.stories if s.status == "done"})


def render_sections(backlog: Backlog) -> dict[str, str]:
    """Every generated section, by the name its page marks it with."""
    history, roadmap = _history(backlog), _roadmap(backlog)
    done_points = sum(s.points for s in history)
    prs = sorted({s.pr for st in history for s in st.stories if s.pr})
    actual = [s.actuals for s in history if s.actuals]
    commits = sum(a["commits"] for a in actual)
    added = sum(a["added"] for a in actual)
    removed = sum(a["removed"] for a in actual)
    last_tests = actual[-1]["tests"] if actual else {}
    first, last = min(s.start for s in history), max(s.finish for s in history)
    bugs = [(st, s) for st, s in backlog.stories() if s.type == "Bug"]
    total_expected = sum(s.expected for s in history)
    total_sigma = math.sqrt(sum(s.sigma ** 2 for s in history))
    sections: dict[str, str] = {}

    sections["numbers"] = _table(["Measure", "Value", "Source"], [
        ["Calendar time", f"{(last - first).days + 1} days, {_span(first, last)}", "Git"],
        ["Build stages", f"{len(history)}, from the specification to the beta", "This file"],
        ["Pull requests merged", f"{len(prs)}, #{prs[0]} to #{prs[-1]}", "GitHub"],
        ["Commits", f"{commits:,}, counting each pull request's own commits", "GitHub and git"],
        ["Lines changed", f"+{added:,} and -{removed:,}", "GitHub"],
        ["Test cases declared at the end", f"{last_tests.get('python', 0)} Python, "
                                            f"{last_tests.get('web', 0)} web, "
                                            f"{last_tests.get('voice', 0)} voice, "
                                            f"{last_tests.get('infra', 0)} infrastructure", "Git"],
        ["Bugs found and fixed", f"{sum(1 for st, s in bugs if s.status == 'done')}", "This file"],
        ["Delivered size", f"{done_points} points", "Estimate"],
        ["Human-team equivalent", f"{total_expected:.0f} person-days expected, "
                                  f"{total_expected - 2 * total_sigma:.0f} to "
                                  f"{total_expected + 2 * total_sigma:.0f} at two standard "
                                  "deviations", "Estimate"],
    ])

    gantt = ["```mermaid", "gantt", "  dateFormat YYYY-MM-DD", "  axisFormat %d %b",
             "  section Built"]
    for stage in history:
        gantt.append(f"  {stage.option} :done, {stage.id.lower()}, {stage.start.isoformat()}, "
                     f"{_active_days(stage)}d")
    gantt.append("  section Planned, forecast")
    for stage in roadmap:
        state = "active, " if stage.status == "in_progress" else ""
        gantt.append(f"  {stage.option} :{state}{stage.id.lower()}, {stage.start.isoformat()}, "
                     f"{_active_days(stage)}d")
    gantt.append("```")
    sections["timeline"] = "\n".join(gantt)

    sections["stages"] = _table(
        ["Stage", "Dates", "What it delivered", "Pull requests", "Points"],
        [[s.option, _span(s.start, s.finish), _first_sentence(s.summary),
          _pr_range(s), str(s.points)] for s in history])

    blocks = []
    for stage in history:
        rows = [[s.id, s.title, s.type + (f", found by {s.found_by.lower()}" if s.found_by else ""),
                 f"#{s.pr}" if s.pr else ", ".join(s.commits), str(s.points)]
                for s in stage.stories]
        block = [f"### {stage.option}", "", f"**{_span(stage.start, stage.finish)}.** {stage.summary}",
                 "", f"**Why it mattered.** {stage.why}"]
        if stage.lesson:
            block += ["", f"**What it taught.** {stage.lesson}"]
        block += ["", _table(["Story", "Title", "Type", "Delivered in", "Points"], rows)]
        if stage.actuals:
            a = stage.actuals
            block += ["", f"From git: {_count(a['commits'], 'commit')}, +{a['added']:,} and "
                          f"-{a['removed']:,} lines across {a['files']:,} files."]
        blocks.append("\n".join(block))
    sections["history"] = "\n\n".join(blocks)

    roadmap_blocks = []
    for horizon, heading in (("now", "Now"), ("next", "Next"), ("later", "Later")):
        stages = [s for s in roadmap if s.horizon == horizon]
        if not stages:
            continue
        rows = [[s.option, _first_sentence(s.why), str(s.points),
                 f"{s.expected:.0f} ({max(0, s.expected - 2 * s.sigma):.0f} to "
                 f"{s.expected + 2 * s.sigma:.0f})",
                 f"{rice_score(s):.0f}", _span(s.start, s.finish), s.risk or "Medium"]
                for s in sorted(stages, key=lambda s: -rice_score(s))]
        roadmap_blocks.append("\n".join([f"### {heading}", "", _table(
            ["Epic", "Why", "Points", "Person-days, expected (range)", "RICE",
             "Forecast window", "Risk"], rows)]))
    sections["roadmap"] = "\n\n".join(roadmap_blocks)

    story_rows = []
    for stage in roadmap:
        for s in stage.stories:
            story_rows.append([s.id, s.title, s.type, str(s.points), STATUS_WORDS[s.status],
                               "<br>".join(s.acceptance)])
    sections["roadmap-stories"] = _table(
        ["Story", "Title", "Type", "Points", "Status", "Done when"], story_rows)

    sections["estimates"] = _table(
        ["Stage", "Points", "Optimistic", "Likely", "Pessimistic", "Expected", "Std dev"],
        [[s.option, str(s.points), _num(s.estimate[0]), _num(s.estimate[1]), _num(s.estimate[2]),
          f"{s.expected:.1f}", f"{s.sigma:.1f}"] for s in backlog.stages]
        + [["All built stages", str(done_points), "", "", "", f"{total_expected:.1f}",
            f"{total_sigma:.1f}"],
           ["All planned stages", str(sum(s.points for s in roadmap)), "", "", "",
            f"{sum(s.expected for s in roadmap):.1f}",
            f"{math.sqrt(sum(s.sigma ** 2 for s in roadmap)):.1f}"]])

    velocity_rows = []
    for stage in history:
        days = _merge_days([stage])
        velocity_rows.append([stage.option, str(stage.points), str(days),
                              f"{stage.points / days:.1f}"])
    build_days = _merge_days(history)
    rate = done_points / build_days
    sections["velocity"] = "\n".join([
        _table(["Stage", "Points", "Days with a merge", "Points per day"], velocity_rows), "",
        f"Across the build: {done_points} points landed on {build_days} distinct days, "
        f"{rate:.1f} points a day. Some days carried work from two stages, so the stage rows "
        f"add up to more than {build_days}."])

    forecast_rows = []
    for stage in roadmap:
        forecast_rows.append([stage.option, str(stage.points), f"{stage.points / rate:.1f}",
                              f"{stage.expected:.0f}"])
    sections["forecast"] = _table(
        ["Epic", "Points", "Days at the build's own pace", "Person-days for a human team"],
        forecast_rows)

    sections["bugs"] = _table(
        ["Story", "What was wrong", "Found by", "Stage", "Fixed in", "Priority"],
        [[s.id, s.title, s.found_by or "", st.option, f"#{s.pr}" if s.pr else "planned",
          PRIORITIES[s.priority or st.priority]] for st, s in bugs])

    found_rows = []
    for stage in history:
        counts = [sum(1 for s in stage.stories if s.type == "Bug" and s.found_by == f)
                  for f in FOUND_BY]
        tests = (stage.actuals or {}).get("tests") or {}
        found_rows.append([stage.option] + [str(c) for c in counts]
                          + [str(sum(tests.values()))])
    sections["quality"] = _table(["Stage"] + list(FOUND_BY) + ["Test cases at the end"], found_rows)
    return sections


def _pr_range(stage: Stage) -> str:
    numbers = sorted({s.pr for s in stage.stories if s.pr})
    if not numbers:
        return "none, direct commits"
    if len(numbers) == 1:
        return f"#{numbers[0]}"
    return f"#{numbers[0]} to #{numbers[-1]}"


def update_docs(root: pathlib.Path = ROOT, check: bool = False,
                backlog: Backlog | None = None) -> list[str]:
    """Rewrite every generated section in docs/project, or list the stale pages."""
    backlog = backlog or load_backlog(root / "docs" / "project" / "backlog.yaml")
    sections = render_sections(backlog)
    stale = []
    for page in sorted((root / "docs" / "project").glob("*.md")):
        text = page.read_text()

        def fill(match: re.Match) -> str:
            name = match.group("name")
            if name not in sections:
                raise KeyError(f"{page.name} asks for a section nobody renders: {name}")
            return f"{match.group(1)}{sections[name]}\n{match.group(4)}"

        updated = GENERATED.sub(fill, text)
        if updated != text:
            stale.append(page.name)
            if not check:
                page.write_text(updated)
    return stale

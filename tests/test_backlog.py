"""The delivery record in docs/project/backlog.yaml, and the pages built from it.

The board on GitHub, the issues behind it and the tables in docs/project are
all generated from one file, so the file is the thing to check. These tests
hold it to the rules a reviewer would otherwise have to remember: every
pull request of the build is on it, sizes use one scale, estimates are labelled as
estimates, and the pages a manager reads match the file they were built from.
"""

from __future__ import annotations

import copy
import datetime
import pathlib

import pytest

from tools.backlog import (
    FIBONACCI, Backlog, load_backlog, pert, render_sections, update_docs, validate,
)
from tests.test_writing_rules import BANNED

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "project"


@pytest.fixture(scope="module")
def backlog() -> Backlog:
    return load_backlog(ROOT / "docs" / "project" / "backlog.yaml")


def test_the_backlog_passes_every_rule(backlog):
    assert validate(backlog) == []


def test_every_pull_request_of_the_build_is_on_the_board(backlog):
    # #1 to #40 were every issue and pull request number the repository had
    # used when the board was backfilled, and all forty merged. Later numbers
    # are shared with the board's own issues, so the sync checks those against
    # GitHub instead.
    numbers = {story.pr for stage in backlog.stages for story in stage.stories if story.pr}
    assert set(range(1, 41)) <= numbers


def test_history_ends_where_the_roadmap_starts(backlog):
    history = [s for s in backlog.stages if s.kind == "history"]
    roadmap = [s for s in backlog.stages if s.kind == "roadmap"]
    assert history and roadmap
    assert all(s.status == "done" for s in history)
    assert max(s.finish for s in history) <= backlog.as_of


def test_an_estimate_is_computed_rather_than_typed():
    expected, sigma = pert(6, 10, 18)
    assert expected == pytest.approx((6 + 40 + 18) / 6)
    assert sigma == pytest.approx(2.0)


def test_the_pages_match_the_file_they_are_built_from():
    stale = update_docs(ROOT, check=True)
    assert stale == [], f"run python -m tools.project_sync --render-docs; stale: {stale}"


def test_every_generated_section_has_a_home_on_a_page(backlog):
    pages = "".join(p.read_text() for p in DOCS.glob("*.md"))
    for name in render_sections(backlog):
        assert f"<!-- generated:{name} -->" in pages, name


@pytest.mark.parametrize("path", sorted(DOCS.glob("*")), ids=lambda p: p.name)
def test_the_project_pages_keep_the_writing_rules(path):
    text = path.read_text()
    assert not BANNED.findall(text), BANNED.findall(text)
    assert "\u2014" not in text and "\u2013" not in text, "no em or en dashes"


# The rules, each shown to refuse the mistake it exists for.

def _story(backlog, story_id):
    for stage in backlog.stages:
        for story in stage.stories:
            if story.id == story_id:
                return story
    raise KeyError(story_id)


def _broken(backlog, change):
    copied = copy.deepcopy(backlog)
    change(copied)
    return validate(copied)


def test_a_size_off_the_scale_is_refused(backlog):
    errors = _broken(backlog, lambda b: setattr(b.stages[1].stories[0], "points", 4))
    assert any("points" in e and "4" in e for e in errors), errors
    assert 4 not in FIBONACCI


def test_a_bug_must_say_how_it_was_found(backlog):
    bug = next(s for st in backlog.stages for s in st.stories if s.type == "Bug")
    errors = _broken(backlog, lambda b: setattr(_story(b, bug.id), "found_by", None))
    assert any(bug.id in e and "found" in e for e in errors), errors


def test_planned_work_needs_acceptance_criteria(backlog):
    todo = next(s for st in backlog.stages for s in st.stories if s.status == "todo")
    errors = _broken(backlog, lambda b: setattr(_story(b, todo.id), "acceptance", []))
    assert any(todo.id in e and "acceptance" in e for e in errors), errors


def test_an_id_is_used_once(backlog):
    first = backlog.stages[1].stories[0].id
    errors = _broken(backlog, lambda b: setattr(b.stages[1].stories[1], "id", first))
    assert any("duplicate" in e and first in e for e in errors), errors


def test_a_story_finishes_inside_its_stage(backlog):
    story = backlog.stages[1].stories[0]
    late = backlog.stages[1].finish + datetime.timedelta(days=3)
    errors = _broken(backlog, lambda b: setattr(_story(b, story.id), "finish", late))
    assert any(story.id in e and "outside" in e for e in errors), errors


def test_an_estimate_runs_optimistic_to_pessimistic(backlog):
    def swap(b):
        b.stages[1].estimate = (b.stages[1].estimate[2], b.stages[1].estimate[1],
                                b.stages[1].estimate[0])
    errors = _broken(backlog, swap)
    assert any("estimate" in e for e in errors), errors


def test_done_work_names_what_delivered_it(backlog):
    story = next(s for st in backlog.stages for s in st.stories if s.pr)
    def unlink(b):
        target = _story(b, story.id)
        target.pr = None
        target.commits = []
    errors = _broken(backlog, unlink)
    assert any(story.id in e and ("pull request" in e or "#" in e) for e in errors), errors

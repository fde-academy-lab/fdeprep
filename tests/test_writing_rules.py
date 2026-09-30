""".claude/rules/02-writing.md, checked on the text a learner reads in problems/.

Seven content authors wrote the catalogue in parallel, and on 30 September
2026 a scan found "unlocked" in three coach lines, "elevated" in a brief and a
hidden case dated Friday 10 October 2026, which is a Saturday. Nothing
checked either, so this does.

What is written badly on purpose is left alone: a weak or adequate exemplar,
a prompt the learner is asked to fix, a pattern or matcher, and anything in
double quotes, which is how a brief quotes the register it warns against.
"""

from __future__ import annotations

import datetime
import pathlib
import re

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = sorted(p for p in (ROOT / "problems").rglob("*.yaml") if "_fixtures" not in p.parts)

# The rule's own list, as word forms. "Leverage" is banned as a verb only,
# which a pattern cannot tell, so it is left to review.
BANNED = re.compile(
    r"\b(delv(e|es|ed|ing)|robust(ly|ness)?|seamless(ly)?|holistic(ally)?|"
    r"unlock(s|ed|ing)?|elevat(e|es|ed|ing)|crucial(ly)?|pivotal|myriad|plethora|"
    r"tapestry|landscapes?|realms?|beginners?)\b",
    re.IGNORECASE,
)
WRITTEN_BADLY_ON_PURPOSE = {"when", "pattern", "value", "match", "original_prompt"}
QUOTED = re.compile(r'"[^"]*"')

MONTHS = ("January February March April May June July August September October "
          "November December").split()
DATED = re.compile(
    r"\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),? (\d{1,2}) "
    r"(" + "|".join(MONTHS) + r")(?:,? (\d{4}))?\b")
# The year every scenario in the catalogue is set in, when a date names none.
SCENARIO_YEAR = 2026


def _read(node, path=()):
    """Every string a learner can read, with where it sits."""
    if isinstance(node, dict):
        if node.get("band") in ("weak", "adequate"):
            return
        for key, value in node.items():
            if key not in WRITTEN_BADLY_ON_PURPOSE:
                yield from _read(value, path + (str(key),))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _read(value, path + (str(index),))
    elif isinstance(node, str):
        yield ".".join(path), node


@pytest.mark.parametrize("path", FILES, ids=[p.stem for p in FILES])
def test_no_word_the_writing_rules_ban(path):
    found = [
        f"{where}: {match.group(0)}"
        for where, text in _read(yaml.safe_load(path.read_text()))
        for match in BANNED.finditer(QUOTED.sub("", text))
    ]
    assert not found, found


@pytest.mark.parametrize("path", FILES, ids=[p.stem for p in FILES])
def test_every_weekday_matches_its_date(path):
    wrong = []
    for where, text in _read(yaml.safe_load(path.read_text())):
        for match in DATED.finditer(text):
            weekday, day, month, year = match.groups()
            actual = datetime.date(int(year or SCENARIO_YEAR), MONTHS.index(month) + 1,
                                   int(day)).strftime("%A")
            if actual != weekday:
                wrong.append(f"{where}: {match.group(0)} is a {actual}")
    assert not wrong, wrong

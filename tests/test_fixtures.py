"""Acceptance 4: each of the ten adversarial fixtures triggers its assertion.

Every case runs a deliberately naive loop against one fixture and asserts that
the fixture's default assertion from docs/03 section 3 comes back failing. A
fixture that no naive loop can fail is decorative.
"""

import pytest

from runner.harness.fixtures import FIXTURES, DEFAULT_ASSERTIONS
from tests.support import run_case

TEN = [
    "tool_lies",
    "tool_soft_error",
    "malformed_on_nth",
    "injected_instruction",
    "schema_drift",
    "slow_then_timeout",
    "loop_bait",
    "budget_squeeze",
    "empty_tool_result",
    "unicode_payload",
]


def test_all_ten_fixtures_are_registered():
    assert sorted(FIXTURES) == sorted(TEN)


def test_every_fixture_declares_a_default_assertion():
    for slug in TEN:
        assert DEFAULT_ASSERTIONS[slug], slug


@pytest.mark.parametrize("slug", TEN)
def test_fixture_triggers_its_assertion_against_a_naive_loop(slug):
    outcome = run_case(slug)
    triggered = [a for a in outcome["assertions"] if a["status"] == "fail"]
    assert triggered, (
        f"{slug} did not fail any of its default assertions against a naive loop: "
        f"{outcome['assertions']}"
    )
    names = {a["type"] for a in triggered}
    expected = set(DEFAULT_ASSERTIONS[slug])
    assert names & expected, (
        f"{slug} failed {names}, none of which is its declared default {expected}"
    )

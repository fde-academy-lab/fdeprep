"""docs/03 sections 1 and 7: no warm-instance reuse of learner code.

In Lambda, /tmp outlives the invocation that wrote it, and the sandbox runs as
the same user as the runner. A file one learner's code leaves there is
readable by the next learner's code on the same instance, and by the same
learner's next Run, which is how a hidden case's input written down during a
submit could be printed back during a later public case. The case's own
working directory was always removed; what else the code wrote was not.

The static gate blocks open(), os and the routes to them, so writing a file
already needs a way past the gate. This is the layer behind it.

The runner image sets RUNNER_SCRATCH_DIR. Nothing else does, because a
developer's /tmp is shared with every other process on the machine.
"""

from __future__ import annotations

import os
import pathlib
import stat
import sys

import pytest

from runner import handler
from runner.battery import scratch
from runner.battery.execute import run_single_case

SPEC = {
    "kind": "agent_run",
    "llm_script": [{"match": "*", "reply": "Final Answer: done"}],
    "budget": {"max_llm_calls": 2, "max_tool_calls": 2, "wall_ms": 5000},
    "assertions": [{"type": "returns_nonempty"}],
}

# run_single_case skips the static gate, which is what lets this stand in for
# code that found a way past it.
LEAVES_A_NOTE = """
def run_agent(question, llm, tools):
    with open(question + "/note.txt", "w") as handle:
        handle.write("the input of a hidden case")
    return "done"
"""


def _case(directory: pathlib.Path) -> dict:
    return run_single_case("c", {**SPEC, "input": {"question": str(directory)}},
                           LEAVES_A_NOTE, allowed_imports=(), time_limit_s=5)


def test_what_learner_code_writes_outside_its_working_directory_is_gone_after_the_case(
        tmp_path, monkeypatch):
    monkeypatch.setenv(scratch.ENV, str(tmp_path))
    assert _case(tmp_path)["status"] == "pass"
    assert list(tmp_path.iterdir()) == []


def test_without_the_setting_nothing_outside_the_case_is_touched(tmp_path, monkeypatch):
    monkeypatch.delenv(scratch.ENV, raising=False)
    _case(tmp_path)
    assert (tmp_path / "note.txt").read_text() == "the input of a hidden case"


def test_clear_empties_the_directory_and_keeps_it(tmp_path):
    (tmp_path / "file.txt").write_text("x")
    (tmp_path / "a" / "b").mkdir(parents=True)
    (tmp_path / "a" / "b" / "deep.txt").write_text("y")
    os.mkfifo(tmp_path / "pipe")
    scratch.clear(str(tmp_path))
    assert tmp_path.is_dir()
    assert list(tmp_path.iterdir()) == []


def test_clear_removes_a_link_and_never_what_it_points_at(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_text("runner state")
    area = tmp_path / "area"
    area.mkdir()
    (area / "to-dir").symlink_to(outside, target_is_directory=True)
    (area / "to-file").symlink_to(outside / "keep.txt")
    scratch.clear(str(area))
    assert list(area.iterdir()) == []
    assert (outside / "keep.txt").read_text() == "runner state"


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads a locked directory anyway")
def test_clear_unlocks_a_directory_the_code_locked(tmp_path):
    locked = tmp_path / "locked"
    (locked / "inner").mkdir(parents=True)
    (locked / "inner" / "note.txt").write_text("x")
    (locked / "inner").chmod(0)
    locked.chmod(0)
    scratch.clear(str(tmp_path))
    assert list(tmp_path.iterdir()) == []


def test_clear_removes_a_tree_deeper_than_the_recursion_limit_and_path_max(tmp_path):
    """A tree nested past what a recursive delete survives would otherwise
    keep whatever sits at the bottom for the next learner."""
    depth = max(sys.getrecursionlimit() + 200, 4096 // 2 + 200)
    fd = os.open(tmp_path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for _ in range(depth):
            os.mkdir("d", dir_fd=fd)
            child = os.open("d", os.O_RDONLY | os.O_DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        with open(os.open("bottom.txt", os.O_WRONLY | os.O_CREAT, 0o600, dir_fd=fd), "w") as f:
            f.write("kept for later")
    finally:
        os.close(fd)
    scratch.clear(str(tmp_path))
    assert list(tmp_path.iterdir()) == []


def test_clear_survives_a_name_its_own_hoisting_would_use(tmp_path):
    (tmp_path / "outer" / "inner").mkdir(parents=True)
    for n in range(4):
        (tmp_path / f"{scratch.HOIST_PREFIX}{n}").write_text("in the way")
    scratch.clear(str(tmp_path))
    assert list(tmp_path.iterdir()) == []


# The handler, which is the Lambda entry point.

PROBLEM = {
    "slug": "scratch", "artefact_type": "code", "difficulty": "easy", "call_budget": 2,
    "tests": [{"name": "p1", "visibility": "public", "spec": {**SPEC, "input": {"question": "q"}}}],
}
REJECTED = "import os\ndef run_agent(question, llm, tools):\n    return 'x'\n"


def test_an_invocation_starts_by_clearing_what_an_earlier_one_left(tmp_path, monkeypatch):
    """The gate rejects this solution, so no case runs and only the clear at
    the start of the invocation can have removed the file."""
    monkeypatch.setenv(scratch.ENV, str(tmp_path))
    (tmp_path / "left-by-the-last-learner.txt").write_text("x")
    result = handler.lambda_handler({"problem": PROBLEM, "solution": REJECTED})
    assert result["gates"]["static"]["status"] == "fail"
    assert list(tmp_path.iterdir()) == []


def test_an_invocation_that_cannot_clear_runs_no_learner_code(tmp_path, monkeypatch):
    monkeypatch.setenv(scratch.ENV, str(tmp_path))

    def refuse(directory):
        raise OSError("read-only file system")

    ran = []
    monkeypatch.setattr(scratch, "clear", refuse)
    monkeypatch.setattr(handler, "run_battery", lambda *a, **k: ran.append(1))
    result = handler.lambda_handler({"problem": PROBLEM, "solution": LEAVES_A_NOTE})
    assert ran == []
    assert result["verdict"] == "error"
    assert result["consumes_allowance"] is False
    assert "not counted" in result["message"]


def test_the_sandbox_never_sees_the_setting(tmp_path, monkeypatch):
    from runner.battery.host import child_env
    monkeypatch.setenv(scratch.ENV, str(tmp_path))
    assert scratch.ENV not in child_env(pathlib.Path(__file__).resolve().parents[1])


def test_the_image_sets_it(tmp_path):
    dockerfile = (pathlib.Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
    assert f"ENV {scratch.ENV}=/tmp" in dockerfile


def test_clear_leaves_the_directory_itself_as_it_was(tmp_path):
    before = stat.S_IMODE(tmp_path.stat().st_mode)
    scratch.clear(str(tmp_path))
    assert stat.S_IMODE(tmp_path.stat().st_mode) == before

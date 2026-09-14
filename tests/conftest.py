import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PROBLEM = ROOT / "problems/agent-loop/recover-from-soft-tool-errors.yaml"
SOLUTIONS = ROOT / "problems/agent-loop/solutions"


@pytest.fixture(scope="session")
def problem():
    from runner.problem import load_problem

    return load_problem(PROBLEM)


@pytest.fixture(scope="session")
def reference_source():
    return (SOLUTIONS / "reference_solution.py").read_text()


@pytest.fixture(scope="session")
def naive_source():
    return (SOLUTIONS / "naive_solution.py").read_text()

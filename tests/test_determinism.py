"""Acceptance 3, the one that matters. Twenty runs, byte-identical gates."""

import json

from runner.battery.execute import run_battery

RUNS = 20


def test_twenty_runs_produce_byte_identical_gates(problem, reference_source):
    blobs = {
        json.dumps(run_battery(problem, reference_source)["gates"], sort_keys=True)
        for _ in range(RUNS)
    }
    assert len(blobs) == 1, f"{len(blobs)} distinct gates results across {RUNS} runs"


def test_twenty_runs_of_a_failing_solution_are_also_identical(problem, naive_source):
    blobs = {
        json.dumps(run_battery(problem, naive_source)["gates"], sort_keys=True)
        for _ in range(RUNS)
    }
    assert len(blobs) == 1, f"{len(blobs)} distinct gates results across {RUNS} runs"


def test_traces_are_identical_apart_from_timings(problem, reference_source):
    """Gates must be byte-identical. Traces must be too, once timings are dropped."""

    def stripped(result):
        for case in result["trace"]["cases"]:
            for step in case["trace"]["steps"]:
                step.pop("ms", None)
        return json.dumps(result["trace"], sort_keys=True)

    blobs = {stripped(run_battery(problem, reference_source)) for _ in range(5)}
    assert len(blobs) == 1, f"{len(blobs)} distinct traces across 5 runs"

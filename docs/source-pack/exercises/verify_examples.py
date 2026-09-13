"""Local authoring QA only. Never execute uploaded learner code with this utility."""
from pathlib import Path
import importlib.util, json
root = Path(__file__).parent
passed = 0
for folder in sorted(p for p in root.iterdir() if p.is_dir()):
    tests = json.loads((folder / "authoring-tests.json").read_text())
    outcomes = {}
    for name in ["instructor_solution", "starter"]:
        spec = importlib.util.spec_from_file_location(folder.name + name, folder / (name + ".py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        failures = 0
        for case in tests:
            try:
                actual = module.solve(case["input"])
                failures += actual != case["expected"]
            except Exception:
                failures += 1
        outcomes[name] = failures
    assert outcomes["instructor_solution"] == 0, (folder.name, outcomes)
    assert outcomes["starter"] > 0, (folder.name, "starter unexpectedly passes")
    passed += len(tests)
    print(folder.name, "reference passes", len(tests), "cases; starter fails", outcomes["starter"])
print("Validated", passed, "cases across four examples.")

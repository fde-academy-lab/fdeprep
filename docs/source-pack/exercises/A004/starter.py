def solve(data):
    events = data["events"]
    limit = data["max_actions"]
    actions = 0
    # TODO 1: validate the action limit.
    # TODO 2: stop before consuming an event beyond the budget.
    # TODO 3: distinguish tool, final and invalid events.
    return {"status": "no_final", "answer": None, "actions": actions}

def solve(data):
    limit = data["max_actions"]
    if type(limit) is not int or not 1 <= limit <= 6:
        return {"status": "invalid_budget", "answer": None, "actions": 0}
    actions = 0
    for event in data["events"]:
        if actions >= limit:
            return {"status": "budget_exceeded", "answer": None, "actions": actions}
        if event["type"] == "final":
            return {"status": "completed", "answer": event["value"], "actions": actions}
        if event["type"] != "tool":
            return {"status": "invalid_event", "answer": None, "actions": actions}
        actions += 1
    return {"status": "budget_exceeded" if actions >= limit else "no_final", "answer": None, "actions": actions}

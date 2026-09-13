def solve(data):
    errors = ["extra:" + key for key in data if key not in {"order_id", "include_history", "limit"}]
    if not isinstance(data.get("order_id"), str) or not data["order_id"].strip():
        errors.append("invalid:order_id")
    if "include_history" in data and type(data["include_history"]) is not bool:
        errors.append("invalid:include_history")
    if "limit" in data and (type(data["limit"]) is not int or not 1 <= data["limit"] <= 20):
        errors.append("invalid:limit")
    return {"ok": False, "errors": sorted(errors)} if errors else {"ok": True}

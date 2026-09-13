import hashlib
import json

def solve(data):
    action_digest = hashlib.sha256(json.dumps(data["action"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    approval = data["approval"]
    reason = None
    if approval.get("approved") is not True:
        reason = "not_approved"
    elif approval.get("actor") != data["actor"]:
        reason = "actor_mismatch"
    elif approval.get("digest") != action_digest:
        reason = "action_changed"
    elif approval["expires_at"] <= data["now"]:
        reason = "expired"
    return {"allowed": False, "reason": reason} if reason else {"allowed": True, "digest": action_digest}

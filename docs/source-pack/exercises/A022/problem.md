# A022: Bind approval to an exact action

Agentic AI · Hard

Northstar needs a deterministic authorization decision before an escalation action. Input contains action, actor, approval and now. Compute SHA-256 of the UTF-8 canonical action JSON using sorted keys, compact separators and ensure_ascii=False. Approval must have approved exactly true, actor equal to the current actor, digest equal to the computed action digest and expires_at greater than now. Check denial reasons in this order: not_approved, actor_mismatch, action_changed, expired. Return {allowed:false, reason:<reason>} for a denial and {allowed:true, digest:<digest>} otherwise. Input fixture types follow the published JSON schema. This function decides authorization only; the runtime must revalidate at execution and separately enforce tool permission and idempotency.

## Interface

`solve({action:object, actor:string, approval:object, now:integer}) -> authorization decision`

## Passing rule

Every listed case must pass. Input objects use JSON-compatible types and string keys. Additional published constraints must be versioned. The authoring test file and instructor solution are private instructional assets and must never be staged with candidate code in production.

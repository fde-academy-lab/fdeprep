# A008: Reject invalid action arguments

Agentic AI · Medium

An order-status tool accepts order_id (nonempty string), include_history (optional boolean), and limit (optional integer 1–20). Only these keys are permitted. Return {ok: true} when valid. Otherwise return {ok: false, errors: [...]} with all applicable error labels sorted alphabetically. Labels are extra:<key>, invalid:order_id, invalid:include_history and invalid:limit. A missing order_id is invalid. Whitespace-only IDs are invalid. Booleans must not pass the integer check. Do not coerce values or execute a tool.

## Interface

`solve(arguments_object) -> {ok, errors?}`

## Passing rule

Every listed case must pass. Input objects use JSON-compatible types and string keys. Additional published constraints must be versioned. The authoring test file and instructor solution are private instructional assets and must never be staged with candidate code in production.

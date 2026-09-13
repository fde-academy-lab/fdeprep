# A004: Stop before the seventh action

Agentic AI · Easy

Northstar support automation sometimes repeats itself. Complete a controller that reads a supplied list of model events. Execute at most max_actions tool events. A final event returns its answer. Before reading another event, if the action budget has been consumed, return budget_exceeded; do not read a final answer beyond the limit. Reject an unknown event type as invalid_event. If events end first, return no_final. max_actions is an integer from 1 to 6; booleans are invalid.

## Interface

`solve({events: [{type: tool|final, value: string}], max_actions: integer}) -> {status, answer, actions}`

## Passing rule

Every listed case must pass. Input objects use JSON-compatible types and string keys. Additional published constraints must be versioned. The authoring test file and instructor solution are private instructional assets and must never be staged with candidate code in production.

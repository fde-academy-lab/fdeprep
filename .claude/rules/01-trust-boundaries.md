# Trust boundaries

These hold in every phase. A change that weakens one of them is a change to the
security model and needs saying out loud in the pull request, not a silent edit.

## The two Lambdas never merge

The runner executes learner code. It has no Bedrock permission, no database
write permission, and sits in a VPC with no internet route. The judge calls
models and never executes learner code. Results return through a queue.

If a task seems to need learner code to call a model, use the step protocol in
`docs/03-RUNNER-AND-GRADING.md` section 9.4 instead.

## Hidden means unpublished, not unreadable

Learner code can read anything staged into its own process. Stage one case, or
a bounded batch, per invocation. Never stage an expected output next to an
input. Comparison happens in the trusted evaluator, outside the sandbox.

## The harness objects are staged, so their internals are closed

Learner code holds the mock model and the tool table, because it has to call
them. It may not read their private attributes. `llm._script` is the scripted
model, which turns a problem into a lookup, and `llm._trace` is the trace every
count in the result is recomputed from, which is how a solution would write
tool calls that never happened.

The static gate rejects a private attribute read on anything other than `self`,
`cls` or `super()`. Assertions were never staged and still are not, so this is
about the objects rather than about expected values.

## Never trust learner-reported anything

Pass counts, timings and result summaries printed by learner code are strings,
not facts. Parse bounded schema-valid output, then judge correctness
independently against values generated in the trusted path.

## Client input is never authoritative

The browser may not supply a sandbox id, an execution role, a model
identifier, a storage path, a difficulty, or a cap allowance. Every one of
those is resolved server-side from the enrolment and the problem version.

## A read-only editor range is not a boundary

Allowed edit regions on prompt-surgery problems are enforced on the server.
The editor's read-only styling is an affordance.

## An error verdict never consumes an allowance

Infrastructure failures are the platform's problem, not the learner's. This is
tested, not assumed.

## Prompt injection reaches the judge as data

Learner text going to a judge is wrapped in delimiters and labelled as data.
Judge output is parsed as JSON against a schema and rejected when it does not
conform. A design answer asking for full marks scores on content.

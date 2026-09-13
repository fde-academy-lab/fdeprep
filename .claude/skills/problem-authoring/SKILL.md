---
name: problem-authoring
description: Author a new FDE Prep practice problem as validated YAML with public, hidden and adversarial tests, a reference solution and a naive solution that provably fails. Use whenever a new code, prompt or design problem is being written, or an existing one is being revised, or a topic from the catalogue backlog is being turned into a real problem.
---

# Problem authoring

Read `docs/04-PROBLEM-AUTHORING.md` before writing anything. This skill is the
loop, that document is the schema.

## The loop, in order

1. **Pick the failure, not the topic.** A problem exists to make one specific
   mistake happen. Write that mistake down in one sentence before anything
   else. If you cannot, there is no problem here yet.
2. **Write the brief as a situation.** Somebody is asking for something. The
   learner should be able to picture who. A brief that opens "implement a
   function that" is a task, and tasks teach nothing.
3. **Write the naive solution first.** The one an unprepared learner writes in
   four minutes. Save it as `naive_solution.py`.
4. **Write the hidden tests that catch it.** At least one hidden test must fail
   against the naive solution. If none do, the problem is decorative.
5. **Write the reference solution.** Save as `reference_solution.py`. Solve it
   from the stub in the editor, under the time estimate, without looking at
   the tests you wrote.
6. **Pick adversarial fixtures.** Hard and Extreme need at least one. Each
   carries an `annotation_md` that explains the trap after the attempt closes.
7. **Set the call budget** one above a clean solution and at least two below
   the naive one.
8. **Write hints as a narrowing sequence.** Hint one narrows the search space.
   Hint two names the mechanism. Hint three describes the shape of the fix. No
   hint contains the answer.
9. **Run the validator.** `python -m scripts.validate_problem <path>`.
10. **Run it through the runner.** `python -m runner.local <problem.yaml>
    <reference_solution.py>` must pass every gate, and the naive solution must
    fail at least one hidden test. Commit both results in the pull request body.

## Refuse to proceed when

- The topic has no source material and you would be inventing what an
  interviewer asks. Say so and ask. A thin problem is worse than a missing one.
- The naive solution passes everything you can think of. Either the problem is
  too easy for its tier or the hidden tests are wrong.
- You are tempted to write a seventh test because six felt thin. Count the real
  distinct failures instead.

## Never

- Put an expected output anywhere the sandbox can read it.
- Copy a problem statement, test or solution from another practice product.
- Add a competency tag outside the fixed vocabulary in `docs/00-PRD.md`.
- Mark a problem published. Author it review-ready and let a human publish.

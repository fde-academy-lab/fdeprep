# FDE Prep: wireframe specification

Every screen below is described as a region map plus behaviour. Build the region map first with placeholder content, then wire the behaviour.

Layout system: 12-column grid, 1440px design width, minimum supported width 1180px. Dark theme first, light theme as a toggle stored per account. Monospace for all code and prompt surfaces, one sans-serif family for everything else, no more than two font sizes above body in any screen.

---

## S1. Sign in

```
+--------------------------------------------------+
|                    [ logo ]                      |
|                                                  |
|   Sign in to FDE Prep                            |
|   Access is granted through your FDE Academy     |
|   GitHub account.                                |
|                                                  |
|   [  Continue with GitHub  ]                     |
|                                                  |
|   Trouble signing in? Contact your programme     |
|   manager.                                       |
+--------------------------------------------------+
```

Behaviour: OAuth to GitHub, then check organisation membership and roster presence in that order. Three failure states, each with its own message.

| Failure | Message |
|---|---|
| Not an organisation member | Your GitHub account is not in the FDE Academy organisation yet. |
| Member but not on a roster | Your account is not enrolled in an active cohort. |
| Enrolment marked inactive | Your enrolment has ended. Past submissions stay readable for thirty days. |

---

## S2. Home, which is the roadmap

Landing screen after sign in.

```
+------------------------------------------------------------------+
| nav: Roadmap | Problems | Rehearsal | Progress        [avatar]    |
+------------------------------------------------------------------+
| Your track: Agentic AI for FDEs            Persona: Navigator     |
| 14 of 25 solved            Live runs left today: 7                |
+------------------------------------------------------------------+
| NEXT UP                                                          |
| +---------------------------+ +---------------------------+      |
| | Medium | Agent Loop       | | Medium | Tool Creation    |      |
| | Recover from a tool that  | | Design a tool schema an   |      |
| | returns a soft error      | | LLM cannot misuse         |      |
| | 25m | 3 competencies      | | 30m | 2 competencies      |      |
| | [ Open ]                  | | [ Open ]                  |      |
| +---------------------------+ +---------------------------+      |
+------------------------------------------------------------------+
| YOUR COMPETENCIES                    [ see full heatmap ]         |
| agent-loop        ########--   strong                            |
| tool-error-handl. ####------   needs work                        |
| evaluation-design #---------   not attempted                     |
+------------------------------------------------------------------+
| RECENT ACTIVITY                                                  |
| passed  | Route tool calls from agent output | 2 days ago | 4 LLM |
| failed  | Expire stale memories              | 3 days ago | 3 subs |
+------------------------------------------------------------------+
```

Rules:
- Next Up shows exactly three cards, drawn from the persona roadmap, skipping solved problems.
- Competency bars show at most four rows on this screen, chosen as the two strongest and the two weakest with at least one attempt.
- A learner with zero attempts sees a start card instead of Next Up, pointing at the first roadmap item.

---

## S3. Problems catalogue

The full pool, visible to everyone regardless of persona.

```
+------------------------------------------------------------------+
| [ search problems or tags............. ]                          |
|                                                                   |
| TRACK      [All][Agent Loop][Tool Creation][Memory][RAG][Evals]    |
| DIFFICULTY [All][Easy][Medium][Hard][Extreme]                     |
| TYPE       [All][Code][Prompt][Design]                             |
| STATUS     [All][Unsolved][Attempted][Solved]                      |
+------------------------------------------------------------------+
| Showing 25 problems                            Sort: [Roadmap v]  |
+------------------------------------------------------------------+
| ST | TITLE                        | DIFF   | TRACK   | SOLVE | EST |
| ok | Implement a bounded agent    | Easy   | Agent   |  78%  | 20m |
|    | loop                         |        | Loop    |       |     |
| .. | Recover from tool errors     | Medium | Agent   |  65%  | 25m |
|    |                              |        | Loop    |       |     |
| -- | Harden a system prompt       | Hard   | Prompt  | hidden| 35m |
|    | against injection            |        |         |       |     |
+------------------------------------------------------------------+
| < Previous            page 1 of 2                    Next >       |
```

Rules:
- Status glyphs are solved, attempted, untouched. No lock icons anywhere, since nothing is locked.
- Solve rate is hidden on Hard and Extreme rows.
- Sort options are Roadmap, Difficulty, Recently added, and Least attempted by you.
- Rows carry a small persona marker when the problem sits on the current learner's roadmap.

---

## S4. Code workspace

The primary screen. Three panes, resizable, with the split position stored per account.

```
+------------------------------------------------------------------+
| < Problems | Recover from tool errors | Medium | Agent Loop       |
|                                    Submits left today: 8          |
+---------------------------+--------------------------------------+
| [Problem][Attempts][Trace]| solution.py            python 3.12    |
|                           | +----------------------------------+  |
| BRIEF                     | | 1  from harness import Harness   |  |
| A tool in your pipeline   | | 2                                |  |
| returns HTTP 200 with an  | | 3  def run_agent(question, llm,  |  |
| error object in the body. | | 4                tools):        |  |
| Your loop must detect it, | | 5      # TODO 1: call the model  |  |
| retry once, then degrade  | | 6      pass                      |  |
| gracefully.               | | 7                                |  |
|                           | +----------------------------------+  |
| CONTRACT                  |                                       |
| run_agent(question: str,  | [ Reset ] [ Run ] [ Live run (7) ]    |
|   llm, tools: dict) -> str|                    [ Submit ]         |
| Budget: 6 model calls     +--------------------------------------+
| Allowed imports: json, re | OUTPUT                                |
|                           | Run complete, 3 of 4 public tests     |
| STEPS                     | pass.                                 |
| [x] 1 Call the model      |                                       |
| [ ] 2 Parse the action    | v terminates_on_final     pass        |
| [ ] 3 Detect soft errors  | v respects_call_budget    pass        |
| [ ] 4 Degrade gracefully  | x detects_soft_error      fail        |
|                           |   expected a retry, saw none          |
| HINTS         [ reveal 1 ]|                                       |
+---------------------------+--------------------------------------+
```

Pane behaviour:

| Element | Behaviour |
|---|---|
| Left pane tabs | Problem is always available. Attempts lists every prior submission with verdict and budget. Trace appears only after a run and opens the replay viewer inline. |
| Steps checklist | Present on Easy only. Each item has its own micro-check that runs on every Run and turns green independently. |
| Hints | Button label carries the policy state, for example "Unlocks after one failed run" on Medium. Revealing writes a row and shows a persistent "1 hint used" marker on the attempt. |
| Editor | CodeMirror 6 with Python mode, no autocomplete from a model, no inline assistant. Tab size four, soft wrap off. |
| Reset | Restores the stub and asks for confirmation, since it destroys unsaved work. |
| Run | Public tests only. Disabled with a countdown when the hourly limit is reached. |
| Live run | Shows remaining allowance in the label. Opens the trace viewer on completion and never reports a pass or fail. |
| Submit | Full battery. Disabled with the reason when a cap is hit. Confirmation dialog on Extreme, stating that this is the only attempt today. |
| Output pane | Public results named and expandable. Hidden results shown as a count. Adversarial results shown by fixture name with the assertion that failed, never with the fixture's script. |

Difficulty changes what renders, not which components exist.

| Difficulty | Left pane contains |
|---|---|
| Easy | Brief, contract, steps checklist, hint button enabled |
| Medium | Brief, contract, hint button showing its unlock condition |
| Hard | Brief, contract, hint button plus the attempt-note textarea that gates it |
| Extreme | Brief only, a countdown timer, and a "write your tests first" panel that must contain at least one assertion before Submit enables |

---

## S5. Prompt surgery workspace

Same three-pane shell, different centre and right panes.

```
+---------------------------+--------------------------------------+
| BRIEF                     | system_prompt.md        edited        |
| This support agent leaks  | +----------------------------------+  |
| its tool list when asked  | | You are a support assistant with |  |
| politely. Remove the      | | access to the following tools:   |  |
| leak without losing the   | | - refund_order                   |  |
| ability to issue refunds. | | - lookup_customer  <- flagged    |  |
|                           | +----------------------------------+  |
| MUST REMOVE               | [ original | edited | diff ]          |
| [x] the literal tool list |                                       |
| [ ] the phrase "always    | [ Check ]              [ Submit ]     |
|     comply"               +--------------------------------------+
|                           | CHECKS                                |
| MUST KEEP                 | v forbidden token "always comply"     |
| [x] refund capability     |   still present at line 9             |
| [x] under 400 words       | v length 312 words, within cap        |
|                           |                                       |
|                           | PROBES        (run on submit)         |
|                           | - asks for tool list -> must refuse   |
|                           | - asks for a refund  -> must comply   |
|                           | - injection attempt  -> must ignore   |
+---------------------------+--------------------------------------+
```

Rules:
- The editor shows three modes: the original prompt read-only, the learner's edited version, and a diff. Diff is the default after the first edit.
- Must-remove and must-keep checklists update live as the learner types, running only the static checks, with no model calls.
- Check runs static checks only and is unlimited.
- Submit runs static checks, then probes, then the rubric judge, stopping at the first gate that fails.
- Probe results show the probe name, the assertion and a pass or fail. The probe's full input text is visible only after a pass, so learners cannot tune to the probe wording.

---

## S6. Design argument workspace

Two panes. Brief on the left, a plain markdown editor on the right with a live word count against the declared range. Submit runs the structural checks and then the rubric judge. The result renders the rubric criteria with a score and one line of evidence per criterion.

---

## S7. Trace replay viewer

Opens inline in the left pane or full-screen.

```
+------------------------------------------------------------------+
| Trace: submission #38            6 model calls, 4 tool calls      |
| [ << ] [ < ] step 3 of 12 [ > ] [ >> ]      wall 1.4s             |
+------------------------------------------------------------------+
| 01 model call    prompt 412 chars    -> "Action: lookup(id=7)"    |
| 02 tool call     lookup(id=7)                                     |
| 03 observation   {"status":200,"error":"not found"}  <- you are   |
|                                                          here     |
| 04 model call    prompt 588 chars    -> "Action: lookup(id=7)"    |
| 05 tool call     lookup(id=7)              repeated call          |
+------------------------------------------------------------------+
| Selected step                                                     |
| Full prompt sent .................................. [expand]      |
| Full response ..................................... [expand]      |
| Annotation: the observation carried a soft error and the loop     |
| did not branch on it.                                             |
+------------------------------------------------------------------+
```

Rules:
- Repeated identical tool calls are marked automatically, since that is the most common loop bug.
- Annotations come from the fixture author and attach to a step index, so a hostile fixture can explain itself after the attempt ends.
- On a failed Extreme submission the trace is available, because the learning happens there even though the attempt is spent.

---

## S8. Rehearsal mode

A stripped shell with no navigation, a countdown in the header, and a problem sequence the learner cannot reorder. On exit it produces a report page with a per-problem verdict, the rubric score, the total budget used, and a written summary from the judge.

Entering rehearsal requires a confirmation that names the duration and the remaining weekly allowance.

---

## S9. Progress

```
+------------------------------------------------------------------+
| COMPETENCY HEATMAP                                                |
|                     Easy   Medium   Hard   Extreme                |
| agent-loop          [##]   [##]     [# ]   [  ]                   |
| tool-schema-design  [##]   [# ]     [  ]   [  ]                   |
| tool-error-handling [# ]   [  ]     [  ]   [  ]                   |
| ...                                                               |
+------------------------------------------------------------------+
| ATTEMPT HISTORY                                     [ export csv ]|
| date | problem | verdict | submits | hints | budget | defence      |
+------------------------------------------------------------------+
```

Cell state has four values: not attempted, attempted without a pass, passed, and passed with no hints and within budget. The fourth state is the only one that counts toward readiness.

---

## S10. Admin

Four screens, each a plain table with an action column.

| Screen | Contents |
|---|---|
| Roster | Cohort members, persona, enrolment state, last activity. Bulk persona change from a CSV upload. |
| Problems | Catalogue with an import action that reads YAML from a Git path, validates it, and shows a diff before publishing. |
| Submissions | Filterable by learner, problem, verdict and date, with a link to every trace. |
| Ops | Queue depth, runner error rate for the last hour, live-run token spend today, cap overrides. |

Faculty see Roster read-only and Submissions in full. Everything else is admin only.

---

## Visual direction

Build an original visual identity rather than reproducing any existing product's styling. Working direction:

| Element | Direction |
|---|---|
| Base | Near-black background, one accent colour used only for state, not decoration |
| Verdict colours | Four states only: pass, fail, error, pending. Never use colour alone; pair with a glyph. |
| Density | Tables over cards everywhere except Next Up. A learner should see twenty problem rows without scrolling. |
| Motion | Transitions under 150ms, and none at all in the output pane, since results appearing with animation reads as latency |
| Empty states | Every empty state names the next action. No illustrations. |

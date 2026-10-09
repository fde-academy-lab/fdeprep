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

**Amended 30 September 2026: the invite link.** An invite lands on `/invite/<token>`, which is open without a session. It says whether the link can still be used and offers Continue with GitHub, and it names nothing else about the invite, since whoever holds the link may not be who it was sent to. The token travels through GitHub in an httpOnly cookie and is spent in the callback. Three more refusals, each naming the next action:

| Failure | Message |
|---|---|
| Invite already used | That invite link has already been used. Ask whoever sent it for a new one. |
| Invite expired, withdrawn or unknown | That invite link is no longer valid. Ask whoever sent it for a new one. |
| Invite names another GitHub login | That invite is for a different GitHub account. Sign in with the account it was sent to, or ask for a new invite. |

With `GITHUB_ORG_CHECK=off` the organisation refusal never appears and GitHub is asked for `read:user` only, without `read:org`.

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
| Steps checklist | Present on Easy and Medium, where docs/00 section 3.2 puts layer L3. Each item has its own micro-check that runs on every Run and turns green independently. Amended 30 September 2026: this line said Easy only, while docs/00, the policy module and the catalogue's 83 Medium steps all had it on Medium too. |
| Hints | Button label carries the policy state, for example "Unlocks after one failed run" on Medium. Revealing writes a row and shows a persistent "1 hint used" marker on the attempt. |
| Editor | CodeMirror 6 with Python mode, no autocomplete from a model, no inline assistant. Tab size four, soft wrap off. |
| Reset | Restores the stub and asks for confirmation, since it destroys unsaved work. |
| Run | Public tests only. Disabled with a countdown when the hourly limit is reached. |
| Live run | Shows remaining allowance in the label. Opens the trace viewer on completion and never reports a pass or fail. |
| Submit | Full battery. Disabled with the reason when a cap is hit. Confirmation dialog on Extreme, stating that this is the only attempt today. |
| Output pane | Public results named and expandable. Hidden results shown as a count. Adversarial results shown by fixture name with the assertion that failed, never with the fixture's script. |

**Amended 8 October 2026.** The Output pane and the Attempts tab show the hidden and adversarial counts only where the tier shows a hidden count (`00-PRD.md` section 3.2). On Extreme, for a rehearsal submit, and for any result on a problem while the learner sits a rehearsal that holds it, each of those two batteries shows whether it passed, with no count and no case name. The server decides it in the results view, which every one of those readers reads (`03-RUNNER-AND-GRADING.md` section 5).

Difficulty changes what renders, not which components exist.

| Difficulty | Left pane contains |
|---|---|
| Easy | Brief, contract, steps checklist, hint button enabled |
| Medium | Brief, contract, steps checklist, hint button showing its unlock condition |
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

**Amended 30 September 2026.** The editor never opens blank: see the L2 row in `00-PRD.md` section 3.2 for the outline and which tiers open on it.

**All three workspaces, amended 30 September 2026.** Below 768px the panes stop splitting, because a split leaves each one too narrow for a sentence. They become three full-screen tabs: the problem, the editor, and the coach with the results. All three stay mounted, so the editor keeps its text and undo history, and the last tab carries a dot when a run lands or the coach speaks while another tab is open.

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

**Decided 8 October 2026: who reads which case.** The specs disagreed. `03-RUNNER-AND-GRADING.md` section 5 and `02-DATA-MODEL.md` withhold a hidden case's name, S4 shows an adversarial result "never with the fixture's script", and the rule above makes the trace available after a failed Extreme submit. The replay showed every case in full to whoever opened it, so a learner read each hidden and adversarial case's name, the prompts their code built from its input, the scripted model's replies and every tool argument and output. The decision:

| Reader | A public case | A hidden or adversarial case |
|---|---|---|
| Learner | It shows in full, with its name, prompts, model replies, tool calls, outputs and flags. | It shows as one anonymous row in the place it ran, saying how it ended, such as "Hidden case 2 of 4: failed". The row holds no name, input, prompt, model reply, tool argument, output, message or flag. |
| Learner, where the tier shows no hidden count | It shows in full. | A battery's cases share one row, such as "Adversarial cases: at least one failed", because a row per case would count them. This holds on Extreme, for a rehearsal submit, and for any result on a problem while the learner sits a rehearsal that holds it. |
| Faculty and admins | It shows in full. | It shows in full, with its battery and its outcome. |

The replay builder on the server (`web/lib/trace/replay.ts`) does the cutting, so nothing of an unpublished case reaches a learner's browser, and the stored trace keeps every case for faculty and for an appeal. A Run's replay holds its public cases and no row for any other, because a Run never runs one. The fixture author's annotation reaches a learner on the row that stands for its case once the attempt closes, on a pass or a give-up, which keeps the annotation rule above; faculty read it at any time. A case the problem version does not list reads as hidden. The header's call counts and the flags cover the cases the reader reads in full.

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
| Roster | Cohort members, persona, enrolment state, last activity. Bulk persona change from a CSV upload. For admins, an Invites table: make a one-time link with an optional GitHub login, role, persona, lifetime and note, see each invite's state, and withdraw one nobody has used. The link is shown once, when it is made. |
| Problems | Catalogue with an import action that reads YAML from a Git path, validates it, and shows a diff before publishing. |
| Submissions | Filterable by learner, problem, verdict and date, with a link to every trace. |
| Ops | Queue depth, runner error rate for the last hour, live-run token spend today, cap overrides. |

**Amended 8 October 2026: the Overview.** An Overview at `/admin` shows one row per learner with readiness and its four counts, last activity including voice, and the stuck count, derived from Roster and Submissions. Faculty see the Overview and a learner's row, read-only, because it derives from the two screens they already see.

**Amended 8 October 2026: the analytics screens of `11-ANALYTICS-AND-REPORT-CARD.md`.** Each is plain tables, and each empty state names the next action.

| Screen | Contents | Who |
|---|---|---|
| Overview | Gains Export CSV, the cohort standing with its date and row count. | Faculty and admins |
| Cohort, `/admin/cohort` | The stuck list, one learner and problem pair per row; the competency gaps, with the lowest pass rate named in a sentence above the table; interview coverage by round. | Faculty and admins |
| Calibration, `/admin/calibration` | Each problem signal with its number, its sample and what to check first, and how many graded answers panelist 2's index holds per problem. Downloads as Markdown. | Faculty and admins |
| Panel, `/admin/panel` | Panel runs by state, the partial rate, re-evaluations owed, the disagreement rate, P3 latency, and panelist availability by the hour. | Admins |

Ops says waiting for a submission with no verdict and a voice answer with no score, because stuck belongs to the learner and problem pair above.

A learner's page from the Overview ends with their report cards: one row per card issued, with its date, readiness, evaluation count, the start of its hash and a Markdown download, and an Issue a report card button for faculty and admins. It is the page's one action, since a card is a dated copy of the page.

Faculty see Roster read-only and Submissions in full. Everything else is admin only.

**Amended 8 October 2026: the cohort is the boundary (S15.13).** Faculty see their own cohort's rows on Submissions and Disagreements, and open a submission's record, its trace and a voice debrief only for a learner in their cohort. They settle and correct their own cohort's grades only, and hear a recording only once the learner shares it. An admin sees every cohort. A learner opens their own work and nothing else, and an address naming a record outside the reader's reach answers as a page that does not exist.

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

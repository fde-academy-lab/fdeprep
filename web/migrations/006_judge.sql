-- Phase 4: prompt surgery, design arguments and the defence step.
--
-- docs/02 predates docs/03 section 9 and describes neither the judge nor the
-- defence, so these shapes are this build's own and are the part of the
-- migration most worth reviewing.
--
-- The columns added to problem_version hold what the two workspaces render.
-- Probes and exemplars are deliberately not among them: they live only in
-- source_yaml, which the judge worker reads server-side and no view reads at
-- all. docs/01 S5 keeps probe wording from the learner until they pass, and the
-- cheapest way to keep it is for it to have one home that nothing renders from.

alter table problem_version
  add column original_prompt    text,
  add column prompt_rules       jsonb not null default '[]',
  add column word_range         jsonb,
  add column required_headings  jsonb not null default '[]',
  add column rubric             jsonb not null default '[]';

-- The defence from docs/03 section 4.4 runs after a pass on Hard and Extreme
-- code problems. Making it a submission rather than a column update buys the
-- outbox, the lease, the fencing token and the compare-and-set that every
-- other graded thing already goes through.
alter type run_kind    add value if not exists 'defence';
alter type limit_scope add value if not exists 'defence_daily';

alter table attempt add column defence_result jsonb;

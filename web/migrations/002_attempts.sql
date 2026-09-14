-- Attempts and submissions, from docs/02 section 4.
--
-- Two deviations from that section, both forced by the docs/03 section 9
-- corrections, which were adopted after docs/02 was written:
--
--   1. The verdict enum gains 'cancelled'. Section 9.3 lists the terminal
--      states as pass, fail, error, timeout, rejected, cancelled, and a
--      compare-and-set that stops a late result reviving a cancelled
--      submission needs somewhere to record the cancellation.
--   2. Submissions gain a lifecycle status. Section 9.3 names the states
--      queued, running and evaluating, and the row had nowhere to hold them.

create type run_kind          as enum ('run', 'submit', 'live', 'rehearsal_submit');
create type verdict           as enum ('pass', 'fail', 'error', 'timeout', 'rejected', 'cancelled');
create type submission_status as enum ('queued', 'running', 'evaluating', 'terminal');

create table attempt (
  id                bigint generated always as identity primary key,
  enrolment_id      bigint not null references enrolment(id),
  problem_id        bigint not null references problem(id),
  cohort_id         bigint not null references cohort(id),
  first_opened_at   timestamptz not null default now(),
  solved_at         timestamptz,
  gave_up_at        timestamptz,
  hints_used        int not null default 0,
  submit_count      int not null default 0,
  best_budget_calls int,
  attempt_note      text,
  defence_body      text,
  defence_score     numeric(5,2),
  unique (enrolment_id, problem_id)
);

create table submission (
  id                 bigint generated always as identity primary key,
  attempt_id         bigint not null references attempt(id),
  problem_version_id bigint not null references problem_version(id),
  kind               run_kind not null,
  body               text not null,
  body_sha256        text not null,
  status             submission_status not null default 'queued',
  verdict            verdict,
  public_passed      int, public_total int,
  hidden_passed      int, hidden_total int,
  adv_passed         int, adv_total    int,
  llm_calls          int,
  tool_calls         int,
  wall_ms            int,
  score              numeric(5,2),
  trace_s3_key       text,
  result             jsonb,
  queued_at          timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz
);

create index on submission (attempt_id, queued_at desc);
create index on submission (verdict, finished_at desc);
create index on submission (status, queued_at);

create table hint_reveal (
  id          bigint generated always as identity primary key,
  attempt_id  bigint not null references attempt(id),
  hint_id     bigint not null references hint(id),
  revealed_at timestamptz not null default now(),
  unique (attempt_id, hint_id)
);

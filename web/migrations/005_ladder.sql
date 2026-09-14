-- Phase 3: the scaffold ladder, competency scoring and the live run.
--
-- docs/02 section 7 defines competency_score; docs/02 section 4 defines
-- learner_test. Neither existed yet because Phase 2 needed neither.

create table competency_score (
  id            bigint generated always as identity primary key,
  enrolment_id  bigint not null references enrolment(id),
  competency_id bigint not null references competency(id),
  difficulty    difficulty not null,
  state         text not null default 'untouched',
  updated_at    timestamptz not null default now(),
  unique (enrolment_id, competency_id, difficulty),
  constraint competency_score_state_known
    check (state in ('untouched', 'attempted', 'passed', 'clean'))
);

-- Extreme requires learner-written tests before Submit enables, and those
-- tests are stored (docs/00 section 3.2).
create table learner_test (
  id          bigint generated always as identity primary key,
  attempt_id  bigint not null references attempt(id),
  body        text not null,
  created_at  timestamptz not null default now()
);

create index on learner_test (attempt_id, created_at desc);

-- The live run's step protocol (docs/03 section 9.4). The worker writes these
-- rows, not the sandbox, which is what makes the trace authoritative.
create table live_run (
  id                 bigint generated always as identity primary key,
  attempt_id         bigint not null references attempt(id),
  problem_version_id bigint not null references problem_version(id),
  model_id           text not null,
  status             text not null default 'running',
  steps_used         int not null default 0,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz,
  constraint live_run_status_known
    check (status in ('running', 'finished', 'budget_exhausted', 'error'))
);

create table live_run_event (
  id          bigint generated always as identity primary key,
  live_run_id bigint not null references live_run(id),
  seq         int not null,
  kind        text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  unique (live_run_id, seq)
);

-- Give-up is an explicit, recorded choice that unlocks L5 (docs/00 section
-- 3.2). attempt.gave_up_at already exists; this records why and when it was
-- shown, so faculty can tell a considered stop from a rage quit.
alter table attempt add column gave_up_reason text;

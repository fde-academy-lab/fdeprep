-- Rate limits from docs/02 section 6, with the seed policy from that table.

create type limit_scope as enum ('run_hourly', 'submit_daily', 'live_daily', 'rehearsal_weekly');

create table rate_limit_policy (
  id          bigint generated always as identity primary key,
  scope       limit_scope not null,
  difficulty  difficulty,
  cohort_id   bigint references cohort(id),
  max_count   int not null,
  window_s    int not null
);

-- Postgres treats nulls as distinct in a unique index, so the seed rows with a
-- null difficulty or a null cohort would not be deduplicated by a plain unique
-- constraint. nulls not distinct gives the uniqueness docs/02 describes.
create unique index rate_limit_policy_key
  on rate_limit_policy (scope, difficulty, cohort_id) nulls not distinct;

create table rate_limit_counter (
  id            bigint generated always as identity primary key,
  enrolment_id  bigint not null references enrolment(id),
  scope         limit_scope not null,
  problem_id    bigint references problem(id),
  window_start  timestamptz not null,
  count         int not null default 0
);

create unique index rate_limit_counter_key
  on rate_limit_counter (enrolment_id, scope, problem_id, window_start) nulls not distinct;

insert into rate_limit_policy (scope, difficulty, max_count, window_s) values
  ('run_hourly',       null,      30,   3600),
  ('submit_daily',     'easy',    1000, 86400),
  ('submit_daily',     'medium',  10,   86400),
  ('submit_daily',     'hard',    5,    86400),
  ('submit_daily',     'extreme', 1,    86400),
  ('live_daily',       null,      10,   86400),
  ('rehearsal_weekly', null,      2,    604800);

# FDE Prep: data model

Postgres 16. All identifiers snake_case. All timestamps `timestamptz` stored in UTC. Every learner-scoped row carries `cohort_id` so a second cohort costs a foreign key rather than a migration.

Primary keys are `bigint generated always as identity` except where a natural slug is stable and used in URLs, where the slug is a unique key alongside the surrogate key.

---

## 1. Identity and enrolment

```sql
create table app_user (
  id            bigint generated always as identity primary key,
  github_id     bigint not null unique,
  github_login  text   not null,
  display_name  text   not null,
  avatar_url    text,
  email         text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create table cohort (
  id          bigint generated always as identity primary key,
  slug        text not null unique,           -- c3, c4
  name        text not null,
  starts_on   date not null,
  ends_on     date,
  is_active   boolean not null default true
);

create type persona as enum ('builder', 'navigator', 'accelerator');
create type enrolment_state as enum ('active', 'paused', 'ended');
create type app_role as enum ('learner', 'faculty', 'admin');

create table enrolment (
  id          bigint generated always as identity primary key,
  user_id     bigint not null references app_user(id),
  cohort_id   bigint not null references cohort(id),
  persona     persona not null default 'navigator',
  role        app_role not null default 'learner',
  state       enrolment_state not null default 'active',
  joined_at   timestamptz not null default now(),
  unique (user_id, cohort_id)
);

create table persona_change (
  id            bigint generated always as identity primary key,
  enrolment_id  bigint not null references enrolment(id),
  from_persona  persona not null,
  to_persona    persona not null,
  changed_by    bigint not null references app_user(id),
  reason        text not null,
  changed_at    timestamptz not null default now()
);
```

Persona changes are logged because a learner challenging their tier is resolved through a conversation, and that conversation needs a record.

---

## 2. Problems

```sql
create type artefact_type  as enum ('code', 'prompt', 'design');
create type difficulty     as enum ('easy', 'medium', 'hard', 'extreme');

create table problem (
  id                bigint generated always as identity primary key,
  slug              text not null unique,
  title             text not null,
  artefact_type     artefact_type not null,
  difficulty        difficulty not null,
  track             text not null,              -- agent-loop, tool-creation, memory, rag, evals, prompt
  est_minutes       int  not null,
  is_published      boolean not null default false,
  current_version   int not null default 1,
  created_at        timestamptz not null default now()
);

-- Problem content is versioned. A submission always points at the version it ran against,
-- so editing a problem never rewrites history.
create table problem_version (
  id            bigint generated always as identity primary key,
  problem_id    bigint not null references problem(id),
  version       int not null,
  source_yaml   text not null,                  -- the authored file, kept verbatim
  brief_md      text not null,                  -- L0
  contract_md   text,                           -- L1
  stub_code     text,                           -- L2
  steps         jsonb not null default '[]',    -- L3, array of {id, text, check_id}
  reference_md  text,                           -- L5
  model_id      text,                           -- pinned Bedrock model for live runs and judging
  call_budget   int,
  time_limit_s  int not null default 10,
  created_at    timestamptz not null default now(),
  unique (problem_id, version)
);

create table hint (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  ordinal            int not null,
  body_md            text not null,
  unique (problem_version_id, ordinal)
);

create table competency (
  id    bigint generated always as identity primary key,
  slug  text not null unique,
  name  text not null
);

create table problem_competency (
  problem_id    bigint not null references problem(id),
  competency_id bigint not null references competency(id),
  weight        numeric(3,2) not null default 1.00,
  primary key (problem_id, competency_id)
);
```

---

## 3. Tests and fixtures

```sql
create type test_visibility as enum ('public', 'hidden', 'adversarial');

create table problem_test (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  name               text not null,             -- shown for public, withheld otherwise
  visibility         test_visibility not null,
  ordinal            int not null,
  spec               jsonb not null,            -- see 04-RUNNER-AND-GRADING.md
  fixture_slug       text,                      -- set when the test uses a library fixture
  annotation_md      text,                      -- revealed after the attempt, explains the trap
  unique (problem_version_id, ordinal)
);

-- Step checks power the Easy checklist. Each maps to one step id in problem_version.steps.
create table step_check (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  step_id            text not null,
  spec               jsonb not null,
  unique (problem_version_id, step_id)
);

-- Prompt-surgery static rules.
create type prompt_rule_kind as enum ('must_remove', 'must_keep', 'max_words', 'regex_absent', 'regex_present');

create table prompt_rule (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  kind               prompt_rule_kind not null,
  label              text not null,             -- shown in the checklist
  pattern            text,                      -- regex or literal
  numeric_value      int,                       -- for max_words
  ordinal            int not null
);

create table prompt_probe (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  name               text not null,
  user_message       text not null,             -- withheld until the learner passes
  assertion          jsonb not null,            -- {type: refuses|complies|valid_json|absent|present, ...}
  ordinal            int not null
);

-- Rubric drives design problems and the defence step.
create table rubric_criterion (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  label              text not null,
  descriptor_md      text not null,
  weight             numeric(4,2) not null,
  ordinal            int not null
);

create table rubric_exemplar (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  band               text not null,             -- strong, adequate, weak
  body_md            text not null,
  score              numeric(5,2) not null
);
```

Three exemplars per design problem anchor the judge. A judge without anchors drifts between runs and learners notice.

---

## 4. Attempts, submissions and runs

```sql
create type run_kind   as enum ('run', 'submit', 'live', 'rehearsal_submit');
create type verdict    as enum ('pass', 'fail', 'error', 'timeout', 'rejected');

-- One attempt row per learner per problem. It accumulates across submissions.
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
  attempt_note      text,                       -- required to unlock hints on hard
  defence_body      text,
  defence_score     numeric(5,2),
  unique (enrolment_id, problem_id)
);

create table submission (
  id                 bigint generated always as identity primary key,
  attempt_id         bigint not null references attempt(id),
  problem_version_id bigint not null references problem_version(id),
  kind               run_kind not null,
  body               text not null,             -- code, edited prompt, or design answer
  body_sha256        text not null,
  verdict            verdict,
  public_passed      int, public_total int,
  hidden_passed      int, hidden_total int,
  adv_passed         int, adv_total    int,
  llm_calls          int,
  tool_calls         int,
  wall_ms            int,
  score              numeric(5,2),
  trace_s3_key       text,
  result             jsonb,                     -- full result contract
  queued_at          timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz
);

create index on submission (attempt_id, queued_at desc);
create index on submission (verdict, finished_at desc);

create table hint_reveal (
  id          bigint generated always as identity primary key,
  attempt_id  bigint not null references attempt(id),
  hint_id     bigint not null references hint(id),
  revealed_at timestamptz not null default now(),
  unique (attempt_id, hint_id)
);

-- Extreme problems require learner-written tests before submit enables.
create table learner_test (
  id          bigint generated always as identity primary key,
  attempt_id  bigint not null references attempt(id),
  body        text not null,
  created_at  timestamptz not null default now()
);
```

`body_sha256` exists so an identical resubmission can be detected and, on Extreme, rejected without spending the daily allowance.

---

## 5. Tracks and roadmaps

```sql
create table track (
  id       bigint generated always as identity primary key,
  slug     text not null unique,
  name     text not null,
  persona  persona not null
);

create table track_item (
  id         bigint generated always as identity primary key,
  track_id   bigint not null references track(id),
  problem_id bigint not null references problem(id),
  ordinal    int not null,
  is_optional boolean not null default false,
  unique (track_id, ordinal)
);
```

One track per persona at launch. The Problems catalogue reads from `problem`, never from `track_item`, which is what keeps the whole pool open to everyone.

---

## 6. Rate limits

```sql
create type limit_scope as enum ('run_hourly', 'submit_daily', 'live_daily', 'rehearsal_weekly');

create table rate_limit_policy (
  id          bigint generated always as identity primary key,
  scope       limit_scope not null,
  difficulty  difficulty,                       -- null means applies to all
  cohort_id   bigint references cohort(id),     -- null means global default
  max_count   int not null,
  window_s    int not null,
  unique (scope, difficulty, cohort_id)
);

create table rate_limit_counter (
  id            bigint generated always as identity primary key,
  enrolment_id  bigint not null references enrolment(id),
  scope         limit_scope not null,
  problem_id    bigint references problem(id),  -- null for account-wide scopes
  window_start  timestamptz not null,
  count         int not null default 0,
  unique (enrolment_id, scope, problem_id, window_start)
);
```

Windows are rolling. A window row is created on first use and expired by a nightly job rather than held open, so a learner in any time zone gets the same allowance.

Seed policy:

| scope | difficulty | max_count | window |
|---|---|---|---|
| run_hourly | null | 30 | 3600s |
| submit_daily | easy | 1000 | 86400s |
| submit_daily | medium | 10 | 86400s |
| submit_daily | hard | 5 | 86400s |
| submit_daily | extreme | 1 | 86400s |
| live_daily | null | 10 | 86400s |
| rehearsal_weekly | null | 2 | 604800s |

---

## 7. Competency scoring

```sql
create table competency_score (
  id            bigint generated always as identity primary key,
  enrolment_id  bigint not null references enrolment(id),
  competency_id bigint not null references competency(id),
  difficulty    difficulty not null,
  state         text not null,   -- untouched, attempted, passed, clean
  updated_at    timestamptz not null default now(),
  unique (enrolment_id, competency_id, difficulty)
);
```

State transitions are one-way and computed on every finished submission.

| State | Condition |
|---|---|
| `untouched` | No submission against any problem carrying this competency at this difficulty |
| `attempted` | At least one submission, no pass |
| `passed` | At least one passing submission |
| `clean` | A passing submission with zero hints revealed and `llm_calls` at or under the problem's call budget |

Readiness counts `clean` only. A pass with four hints is progress and is not evidence.

---

## 8. Rehearsals

```sql
create table rehearsal (
  id            bigint generated always as identity primary key,
  enrolment_id  bigint not null references enrolment(id),
  started_at    timestamptz not null default now(),
  ends_at       timestamptz not null,
  finished_at   timestamptz,
  problem_ids   bigint[] not null,
  report        jsonb
);
```

---

## 9. Audit and ops

```sql
create table audit_log (
  id         bigint generated always as identity primary key,
  actor_id   bigint references app_user(id),
  action     text not null,
  target     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create table runner_event (
  id            bigint generated always as identity primary key,
  submission_id bigint references submission(id),
  level         text not null,     -- info, warn, error
  message       text not null,
  detail        jsonb,
  created_at    timestamptz not null default now()
);
```

Log every persona change, cap override, problem publish and roster edit. The ops dashboard reads `runner_event` for the last hour and nothing older.

---

## 10. Retention

| Data | Retention |
|---|---|
| Submissions and verdicts | Life of the cohort plus two years, since placement conversations reference them |
| Traces in S3 | 180 days, then lifecycle to Glacier for a year, then delete |
| Runner events | 30 days |
| Rate limit counters | 30 days |
| Learner code bodies | Same as submissions |

Traces are the largest object by volume. Cap a stored trace at 256KB and truncate the middle with a marker rather than storing an unbounded loop.

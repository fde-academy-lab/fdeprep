-- Identity, problems and tests, transcribed from docs/02 sections 1 to 3.
-- Phase 2 needs enough of identity to own an attempt; the GitHub sign-in
-- itself is Phase 5.

create type persona         as enum ('builder', 'navigator', 'accelerator');
create type enrolment_state as enum ('active', 'paused', 'ended');
create type app_role        as enum ('learner', 'faculty', 'admin');
create type artefact_type   as enum ('code', 'prompt', 'design');
create type difficulty      as enum ('easy', 'medium', 'hard', 'extreme');
create type test_visibility as enum ('public', 'hidden', 'adversarial');

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
  slug        text not null unique,
  name        text not null,
  starts_on   date not null,
  ends_on     date,
  is_active   boolean not null default true
);

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

create table problem (
  id                bigint generated always as identity primary key,
  slug              text not null unique,
  title             text not null,
  artefact_type     artefact_type not null,
  difficulty        difficulty not null,
  track             text not null,
  est_minutes       int  not null,
  is_published      boolean not null default false,
  current_version   int not null default 1,
  created_at        timestamptz not null default now()
);

create table problem_version (
  id            bigint generated always as identity primary key,
  problem_id    bigint not null references problem(id),
  version       int not null,
  source_yaml   text not null,
  brief_md      text not null,
  contract_md   text,
  stub_code     text,
  steps         jsonb not null default '[]',
  reference_md  text,
  model_id      text,
  call_budget   int,
  time_limit_s  int not null default 10,
  allowed_imports jsonb not null default '[]',
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

create table problem_test (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  name               text not null,
  visibility         test_visibility not null,
  ordinal            int not null,
  spec               jsonb not null,
  fixture_slug       text,
  annotation_md      text,
  unique (problem_version_id, ordinal)
);

create table step_check (
  id                 bigint generated always as identity primary key,
  problem_version_id bigint not null references problem_version(id),
  step_id            text not null,
  spec               jsonb not null,
  unique (problem_version_id, step_id)
);

create table audit_log (
  id         bigint generated always as identity primary key,
  actor_id   bigint references app_user(id),
  action     text not null,
  target     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

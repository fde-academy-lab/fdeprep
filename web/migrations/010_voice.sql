-- The Voice Screen schema, transcribed from docs/07 section 8.
--
-- Phase 7a builds capture and transport, so only voice_consent and
-- voice_session carry rows yet. The rest land whole rather than in pieces,
-- because a table added a column at a time reads as three migrations of
-- history for one design.

create type voice_mode as enum ('guided', 'unguided', 'pressure');

create table voice_question (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  title         text not null,
  track         text not null,
  difficulty    difficulty not null,
  total_seconds int not null,
  prompt_text   text not null,
  prompt_audio_key text,
  source_yaml   text not null,
  is_published  boolean not null default false
);

create table voice_beat (
  id                bigint generated always as identity primary key,
  voice_question_id bigint not null references voice_question(id),
  beat_key          text not null,
  label             text not null,
  seconds           int not null,
  anchors           text[] not null,
  ordinal           int not null,
  unique (voice_question_id, beat_key)
);

create table voice_session (
  id                bigint generated always as identity primary key,
  enrolment_id      bigint not null references enrolment(id),
  voice_question_id bigint not null references voice_question(id),
  cohort_id         bigint not null references cohort(id),
  mode              voice_mode not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  audio_s3_key      text,
  audio_deleted_at  timestamptz,
  transcript        text,
  content_score     numeric(5,2),
  structure_score   numeric(5,2),
  pace_score        numeric(5,2),
  score             numeric(5,2),
  delivery          jsonb,
  judge_result      jsonb
);

create table voice_beat_result (
  id               bigint generated always as identity primary key,
  voice_session_id bigint not null references voice_session(id),
  beat_key         text not null,
  covered          boolean not null,
  live_covered     boolean not null,
  reached_at_ms    int,
  spent_ms         int,
  pace_state       text not null
);

create table voice_nudge (
  id               bigint generated always as identity primary key,
  voice_session_id bigint not null references voice_session(id),
  at_ms            int not null,
  kind             text not null,
  line             text not null,
  was_shown        boolean not null
);

create table voice_consent (
  id           bigint generated always as identity primary key,
  enrolment_id bigint not null references enrolment(id) unique,
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create index on voice_session (enrolment_id, started_at desc);
create index on voice_beat (voice_question_id, ordinal);
create index on voice_beat_result (voice_session_id);
create index on voice_nudge (voice_session_id, at_ms);

-- Voice interviewer v2, step 1: who asks, and what each question says about
-- itself. Everything here is additive with a default or nullable, so the
-- previous release keeps writing and reading against this schema.

-- The nine interviewers, imported from voice-interviewers/ by the same
-- operator action that imports voice-questions/. The browser names a slug and
-- the server resolves it here; nothing in the browser can supply a voice or a
-- probe. A persona the file drops is retired, never deleted, because a past
-- session names it.
create table voice_interviewer (
  id               bigint generated always as identity primary key,
  slug             text not null unique,
  name             text not null,
  role_line        text not null,
  listens_for      text[] not null,
  opening_line     text not null,
  follow_up_style  text not null,
  stress_probes    text[] not null,
  -- Five entries over why, stress and resume, one per round. Section 4.3 of
  -- the plan says how a round is planned from it.
  cadence          text[] not null,
  -- Amazon Polly VoiceId, engine and language tag. Null voice_id only on the
  -- panel, which speaks with its chair's voice.
  voice_id         text,
  voice_engine     text not null default 'neural',
  voice_language   text,
  -- Panel only: member slugs, chair first. Empty for a person.
  members          text[] not null default '{}',
  source_yaml      text not null,
  is_published     boolean not null default false,
  retired_at       timestamptz
);

-- What a question says about the loop it comes from. Nullable so the
-- previous release's import, which writes none of them, still inserts.
alter table voice_question add column if not exists round text;
alter table voice_question add column if not exists tests text;
alter table voice_question add column if not exists interviewers text[] not null default '{}';
alter table voice_question add column if not exists builds_on text[] not null default '{}';
alter table voice_question add column if not exists framework jsonb;
alter table voice_question add column if not exists tips text[] not null default '{}';
-- The per-question cap on follow-up rounds. Null means the policy default.
alter table voice_question add column if not exists interview_rounds int
  check (interview_rounds is null or interview_rounds between 1 and 5);

-- Who asked. A slug rather than a foreign key, for the same reason
-- voice_beat_result names its beat by key: a re-import keeps the link.
-- Null on every session from before this release, which the debrief reads
-- as "no interviewer was chosen".
alter table voice_session add column if not exists interviewer_slug text;

-- Speech that is said more than once, cached once per voice and text: a
-- question read in a persona's voice, an opening line, an authored follow-up
-- in a persona's voice, a persona's probe. Keyed on the hash so a changed
-- line is a new object and the old one is never served for the new words.
create table voice_spoken_line (
  id           bigint generated always as identity primary key,
  voice_id     text not null,
  text_sha256  text not null,
  audio_key    text not null,
  created_at   timestamptz not null default now(),
  unique (voice_id, text_sha256)
);

create index on voice_question using gin (interviewers);
create index on voice_session (interviewer_slug);

-- Voice interviewer v2, step 2: follow-up rounds and the resume.
--
-- The enum gains a value and nothing in this file uses it, because Postgres
-- refuses a value added to an enum inside the transaction that added it
-- (the note in 013 says the same). The previous release never writes
-- 'interview' and reads an interview row as a session of an unknown mode,
-- which its screens render by name.
alter type voice_mode add value if not exists 'interview';

-- One row per follow-up round. The main answer stays on voice_session, so
-- every reader of transcript, score and delivery is unchanged.
create table voice_turn (
  id                    bigint generated always as identity primary key,
  voice_session_id      bigint not null references voice_session(id),
  -- 1 is the first follow-up round.
  ordinal               int not null,
  -- Who asked: a persona slug, or a panel member's slug.
  interviewer_slug      text not null,
  kind                  text not null check (kind in ('why', 'stress', 'resume')),
  -- The level of why this round reached, 0 for a stress probe or a resume
  -- round. Section 4.3 of the plan has the ladder.
  depth                 int not null default 0,
  -- Where the question came from. docs/07 section 5a.
  source                text not null check (source in ('generated', 'authored', 'probe')),
  question_text         text not null,
  authored_follow_up_id bigint references voice_follow_up(id),
  -- S3 key of the spoken question. voice/generated/ for a generated line,
  -- a voice_spoken_line key for an authored one.
  audio_key             text,
  transcript            text,
  transcript_segments   jsonb,
  asked_at              timestamptz not null default now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  -- S14.5: the numbers the first deploy measures. Null where the step did
  -- not run: an authored fallback has no generation, a line with no bucket
  -- has no synthesis.
  generation_ms         int,
  synthesis_ms          int,
  -- Time from the finish request arriving to the next turn being sent.
  gap_ms                int,
  -- A reply that arrived after the deadline, recorded for the measurement
  -- and never used.
  late_generation_ms    int,
  model_calls           int not null default 0,
  input_tokens          int,
  output_tokens         int,
  -- Why the fallback was used: timeout, error, rejected, no_claims.
  fallback_reason       text,
  -- The model's own note of what in the answer it pulled on. Faculty only.
  targets               text,
  unique (voice_session_id, ordinal)
);

-- The claims drawn from a pasted resume, held while the session runs and
-- nulled when it closes. The resume text itself is never written.
alter table voice_session add column if not exists resume_claims jsonb;
alter table voice_session add column if not exists resume_claims_at timestamptz;
-- The cap resolved when the session opened, from the YAML or the policy
-- default, so a content change never changes a running session.
alter table voice_session add column if not exists interview_rounds int;

create index on voice_turn (voice_session_id, ordinal);
create index on voice_session (started_at) where resume_claims is not null;

comment on column voice_session.resume_claims is
  'Claims extracted from a pasted resume, for this session only. Nulled when the '
  'session closes and by the scorer sweep after 24 hours. Never reaches the judge '
  'event that scores the answer, and never reaches a score, the heatmap or the '
  'placement export.';

-- When the main answer ended. In interview mode finished_at marks the close of
-- the whole interview, after its rounds, while pace, the replay and the
-- debrief's clock are about the main answer alone, so they read this when it is
-- set. Null outside interview mode, where the answer ends when the session does,
-- and on every row from before this release.
alter table voice_session add column if not exists answer_finished_at timestamptz;

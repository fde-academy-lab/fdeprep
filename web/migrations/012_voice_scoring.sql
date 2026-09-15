-- Scoring, the debrief and audio privacy. docs/07 sections 6, 7 and 9.
--
-- docs/07 section 2 puts a rubric and three exemplars on the question object
-- and section 8's schema has nowhere to keep either, so these are the missing
-- tables rather than new ideas. Same shape as problem_rubric_criterion and
-- exemplar on the code side, because the judge reads them the same way.

create table voice_rubric_criterion (
  id                bigint generated always as identity primary key,
  voice_question_id bigint not null references voice_question(id),
  criterion_key     text not null,
  label             text not null,
  weight            int not null,
  descriptor_md     text,
  ordinal           int not null,
  unique (voice_question_id, criterion_key)
);

create table voice_exemplar (
  id                bigint generated always as identity primary key,
  voice_question_id bigint not null references voice_question(id),
  band              text not null,
  score             int not null,
  transcript        text not null,
  unique (voice_question_id, band)
);

-- docs/07 section 9: "Faculty access is not automatic. Faculty see
-- transcripts and scores. Audio requires the learner to share that session
-- explicitly." A row here is that share, one session at a time, and it is the
-- learner's to create and to withdraw.
create table voice_session_share (
  id               bigint generated always as identity primary key,
  voice_session_id bigint not null references voice_session(id),
  shared_at        timestamptz not null default now(),
  withdrawn_at     timestamptz,
  unique (voice_session_id)
);

-- Per-segment transcript timings, which the delivery metrics need and the
-- joined transcript in voice_session.transcript cannot carry. Longest pause is
-- the gap between one segment ending and the next beginning, and words per
-- minute needs the speaking window rather than the wall clock.
alter table voice_session add column transcript_segments jsonb;

-- Set when the judge has answered, so a worker can find the sessions it has
-- not scored without a queue. Null while a session is waiting; a failed judge
-- leaves it null and the next pass picks it up again.
alter table voice_session add column scored_at timestamptz;
alter table voice_session add column judge_attempts int not null default 0;

-- docs/07 section 6: reported, never scored. In its own column rather than
-- inside the score so that a query which selects the score cannot pick it up
-- by accident, and so a grep for the column name finds every reader.
comment on column voice_session.delivery is
  'Words per minute, filler count, longest pause. docs/07 section 6: reported '
  'in the debrief and never scored. Must not reach score, the competency '
  'heatmap, or the placement CSV export.';

create index on voice_rubric_criterion (voice_question_id, ordinal);
create index on voice_session (finished_at) where scored_at is null;

-- docs/07 section 10. Guided and unguided get their own daily scopes; a
-- pressure session spends the rehearsal allowance, which section 10 says it
-- shares, so it needs no scope of its own.
alter type limit_scope add value if not exists 'voice_guided_daily';
alter type limit_scope add value if not exists 'voice_unguided_daily';

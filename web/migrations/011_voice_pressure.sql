-- Pressure mode's authored follow-ups, and the record of an interruption.
--
-- docs/07 section 2 puts follow_ups on the question object and section 8's
-- schema has nowhere to keep them, so this is the missing table rather than a
-- new idea. Section 5 caps a session at two interruptions and says the main
-- clock stops while one runs, which is what the two millisecond columns on
-- voice_interruption are for: the debrief has to be able to say the
-- interruption cost the learner nothing on the clock.

create table voice_follow_up (
  id                bigint generated always as identity primary key,
  voice_question_id bigint not null references voice_question(id),
  -- The beat this fires after, by beat_key rather than by id, because the
  -- authored YAML names it that way and a question reimport keeps the link.
  trigger_after_beat text not null,
  text              text not null,
  -- S3 key of the Polly audio. Null until it has been synthesised, because
  -- docs/07 section 7 generates once per question and caches rather than
  -- re-synthesising on every session.
  audio_key         text,
  ordinal           int not null,
  unique (voice_question_id, ordinal)
);

create table voice_interruption (
  id                 bigint generated always as identity primary key,
  voice_session_id   bigint not null references voice_session(id),
  voice_follow_up_id bigint not null references voice_follow_up(id),
  -- Both on the answer's own clock, which excludes earlier interruptions.
  fired_at_ms        int not null,
  ended_at_ms        int,
  unique (voice_session_id, voice_follow_up_id)
);

create index on voice_follow_up (voice_question_id, ordinal);
create index on voice_interruption (voice_session_id, fired_at_ms);

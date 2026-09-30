-- Voice interviewer v2, step 1.
--
-- A follow-up is retired rather than deleted when its file drops it.
-- voice_interruption points at it, so a delete fails once any pressure session
-- has fired it, and a past session's record has to outlive a content change.
-- The importer matches follow-ups by ordinal, keeps the cached audio while the
-- words are unchanged, and clears it when they change.
alter table voice_follow_up add column if not exists retired_at timestamptz;

-- How the answer arrived. A typed answer is the fallback for a learner whose
-- microphone or connection fails. It is scored on content and structure and
-- carries no pace score, because it has no timings to score.
--
-- Both columns are additive and the second has a default, so the previous
-- release keeps writing sessions against this schema, and they read as spoken.
alter table voice_session add column if not exists input text not null default 'spoken'
  check (input in ('spoken', 'typed'));

-- Whether this session holds one unit of its mode's allowance. Set when the
-- session opens and cleared when an answer that said nothing gives the unit
-- back (docs/07 section 12, item 9). Sessions from before this release spent
-- nothing, which is what the default says. The faculty transport check never
-- sets it, so finishing one can never hand back a unit a real answer spent.
alter table voice_session add column if not exists spent_allowance boolean not null default false;

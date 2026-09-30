-- The storyline and the interview angle, docs/04 section 1 as amended
-- 30 September 2026.
--
-- problem.day places a problem in a learner's first 30 days as an FDE and
-- problem.skill says what it practises. Both are copied from the problem file
-- at publish, as the title is. problem_version.interview holds the round and
-- the question from interview_evidence, so the page never reads source_yaml,
-- which also holds the hidden cases.
--
-- Additive and nullable, so the previous release keeps working against this
-- schema, and a problem published before it renders without them until it is
-- published again.
alter table problem add column if not exists day integer
  check (day is null or day between 1 and 30);
alter table problem add column if not exists skill text;
alter table problem_version add column if not exists interview jsonb;

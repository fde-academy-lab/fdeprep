-- What faculty concluded about an evaluation the panel argued over.
-- docs/10 section 9.7 and acceptance criterion 7.
--
-- The consolidator marks a two-band disagreement, holds the lower band and
-- surfaces the row to faculty. The first two have been true since it landed.
-- This table is the third, and without it holding the lower band means an
-- unvalidated panelist can pull a grade down with nobody ever seeing it.
--
-- A review is a reading, not an override. Nothing here changes a score, a band
-- or a competency state, so the rule that `eval/` is the only writer of a grade
-- is untouched: this records that a human looked, and what they thought.
--
-- Additive only: nothing existing is altered, so the previous release runs
-- unchanged against this schema.

create type review_disposition as enum (
  -- The held band is right. The panel argued and the cautious answer won.
  'upheld',
  -- The held band is wrong and the higher one was right. This is the backlog
  -- the grade override will work from when it exists.
  'disputed',
  -- Neither band is the story. The problem itself is miscalibrated, usually
  -- exemplars too close together to separate anything.
  'problem_flagged'
);

create table evaluation_review (
  id            bigserial primary key,

  -- One review per evaluation. A second reading replaces the first rather than
  -- stacking, because a queue showing two answers for one row is a queue that
  -- has to be interpreted before it can be worked.
  evaluation_id bigint not null unique references evaluation (id) on delete cascade,
  reviewer_id   bigint not null references app_user (id),

  disposition   review_disposition not null,

  -- Required, and enforced in code rather than by a check constraint so the
  -- refusal reaches the reviewer as a message rather than a database error.
  -- The person reading this later is not the person who wrote it.
  note          text not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The open queue is "disagreements with no review yet", which is an anti-join
-- against this table, and the disputed list is a scan of one disposition.
create index evaluation_review_disposition_idx
  on evaluation_review (disposition, created_at);

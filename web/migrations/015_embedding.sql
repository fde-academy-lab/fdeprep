-- Panelist 2's nearest-neighbour index. docs/10 section 5.
--
-- The pool starts as the three author-written exemplars per problem and grows
-- by one row per graded submission. That is what lets P2 learn from a cohort
-- without anybody running a training job, and it is why the quality of a band
-- is a function of how many graded answers a problem has, which analytics/
-- reports.
--
-- Additive only: nothing existing is altered, so the previous release runs
-- unchanged against this schema.

create table embedding (
  id            bigserial primary key,
  problem_id    bigint not null references problem (id) on delete cascade,

  -- The band this vector is evidence for. An exemplar carries the band its
  -- author assigned; a submission carries the band the panel settled on.
  band          text not null,

  -- 'exemplar' or 'submission'. Worth distinguishing because an index that is
  -- still only authored exemplars is a different thing from one with three
  -- hundred real answers in it, and a reader should be able to tell.
  source        text not null,
  submission_id bigint references submission (id) on delete cascade,

  -- 384 floats, L2 normalised, so cosine similarity is a dot product.
  vector        real[] not null,

  -- Which model produced it. Vectors from different models are not comparable
  -- at all, so a model change has to invalidate rather than silently mix:
  -- without this column a band would quietly start meaning something else.
  model         text not null,

  created_at    timestamptz not null default now()
);

-- The hot read is "every vector for this problem from this model", once per
-- submission of that problem.
create index embedding_lookup_idx on embedding (problem_id, model);

-- One vector per submission. A re-evaluation replaces rather than duplicates,
-- or a learner who was graded twice would count twice in everybody else's
-- nearest neighbours.
create unique index embedding_submission_idx
  on embedding (submission_id) where submission_id is not null;

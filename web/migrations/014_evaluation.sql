-- The evaluation record. docs/10 section 10.
--
-- One row per submission per evaluation attempt, immutable. A re-run writes a
-- new row rather than updating the old one, so an outage stays auditable after
-- the fact and a learner can be shown why their score moved.
--
-- Additive only, per the standing rule that a migration stays backward
-- compatible for one release: nothing existing is altered, so the previous
-- application version runs unchanged against this schema.

create type evaluation_state as enum ('complete', 'partial', 'error');
create type panel_confidence as enum ('high', 'medium', 'low');

create table evaluation (
  id                bigserial primary key,
  submission_id     bigint not null references submission (id) on delete cascade,
  enrolment_id      bigint references enrolment (id) on delete cascade,

  -- Text rather than an enum. The levels are the policy module's to define and
  -- a migration every time one is renamed buys nothing here.
  complexity        text not null,

  state             evaluation_state not null,
  verdict           verdict,
  score             numeric(6, 2),

  -- True while a panelist the level demanded has not run. The score may rise
  -- when the re-evaluation lands and it may never fall.
  score_provisional boolean not null default false,
  confidence        panel_confidence not null,
  band              text,

  -- Per-panelist status, timing, findings and band. Faculty and the appeal
  -- path read this. A learner never does.
  panel             jsonb not null,
  disagreement      jsonb,

  -- The one voice. Carries no panelist name, which a test enforces.
  feedback_md       text not null,

  created_at        timestamptz not null default now()
);

-- The latest row for a submission is the hot read, on every result render.
create index evaluation_submission_idx
  on evaluation (submission_id, created_at desc);

-- The faculty view is "show me what the panel argued about", which is a small
-- fraction of rows, so the index carries only those.
create index evaluation_disagreement_idx
  on evaluation (created_at desc)
  where disagreement is not null;

-- analytics/ reports the partial rate and drains the re-evaluation backlog.
-- Both filter on state, and both are read far more often than they are written.
create index evaluation_state_idx
  on evaluation (state, created_at desc)
  where state <> 'complete';

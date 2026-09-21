-- The faculty override. docs/00 section 3.1 and docs/10 section 9.7.
--
-- An override is a new evaluation row rather than an edit, because the table is
-- append-only and an appeal has to be able to read what the panel said before a
-- human disagreed with it. These two columns say that the newest row came from
-- a person, which a query can ask without digging through the panel jsonb.
--
-- Additive only: nothing existing is altered, so the previous release runs
-- unchanged against this schema.

alter table evaluation
  add column overridden_by  bigint references app_user (id),
  add column override_note  text;

-- analytics/ reports how often the panel is overruled and by whom, which is the
-- measurement that says whether a panelist is trustworthy. A partial index,
-- because overrides are a small fraction of rows and should stay one.
create index evaluation_override_idx
  on evaluation (overridden_by, created_at desc)
  where overridden_by is not null;

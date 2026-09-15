-- Phase 5: tracks, roadmaps and the trace store.
--
-- track and track_item are docs/02 section 5 verbatim. The catalogue reads from
-- problem and never from track_item, which is what keeps every problem
-- reachable for every persona: the roadmap decides order, not access.

create table track (
  id       bigint generated always as identity primary key,
  slug     text not null unique,
  name     text not null,
  persona  persona not null
);

create table track_item (
  id          bigint generated always as identity primary key,
  track_id    bigint not null references track(id) on delete cascade,
  problem_id  bigint not null references problem(id) on delete cascade,
  ordinal     int not null,
  is_optional boolean not null default false,
  unique (track_id, ordinal)
);

create index on track_item (track_id, ordinal);

-- The trace the runner already returns.
--
-- docs/03 section 5 puts an S3 URI in trace_ref and section 7 has the runner
-- writing traces to S3. That bucket is infrastructure a human deploys, so this
-- table is the local stand-in, the same shape of decision as the queue shim in
-- Phase 2: the replay viewer reads one interface and stops caring where the
-- bytes live.
--
-- It also keeps the trace out of submission.result. docs/03 section 5 says the
-- front end renders from the result contract alone, and that contract carries a
-- reference, not a trace. Leaving a few hundred kilobytes of steps inside the
-- rendered object would make every result read pay for a trace nobody opened.
create table trace (
  submission_id bigint primary key references submission(id) on delete cascade,
  body          jsonb not null,
  step_count    int not null default 0,
  flags         jsonb not null default '[]',
  truncated     boolean not null default false,
  created_at    timestamptz not null default now()
);

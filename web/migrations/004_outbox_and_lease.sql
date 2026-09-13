-- The outbox from docs/03 section 9.2 and the lease from section 9.3.
--
-- docs/02 defines no tables for either. Section 9 was adopted after that
-- document was written and nothing back-filled the schema, so these shapes are
-- this build's own and are the part of the migration most worth reviewing.
--
-- Who claims the lease is the one place section 9.3 and section 7 pull against
-- each other. Section 9.3 says the runner claims a submission with a lease and
-- a fencing token. Section 7 and .claude/rules/01 say the runner has no
-- database write permission, and that separation is the control the whole
-- security model rests on. So the fencing token is issued by the dispatcher,
-- travels in the message, comes back with the result, and the result writer
-- performs the compare-and-set. The guarantee section 9.3 asks for is intact:
-- a late or duplicated runner cannot overwrite a fresh result, because its
-- token no longer matches.

alter table submission
  add column lease_token      uuid,
  add column fencing_token    bigint,
  add column lease_expires_at timestamptz;

create sequence fencing_token_seq as bigint;

-- The outbox row is written in the same transaction as the submission and the
-- cap decrement. A submission with no message hangs in queued forever.
create table outbox (
  id            bigint generated always as identity primary key,
  submission_id bigint not null references submission(id),
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  attempts      int not null default 0,
  last_error    text
);

create index on outbox (sent_at, created_at) where sent_at is null;

-- The local stand-in for SQS. The real queue is infrastructure a human
-- deploys; this table gives the dispatcher, the runner and the result writer
-- the same at-least-once delivery to build against.
create table queue_message (
  id            bigint generated always as identity primary key,
  queue         text not null,
  body          jsonb not null,
  created_at    timestamptz not null default now(),
  visible_at    timestamptz not null default now(),
  received      int not null default 0,
  deleted_at    timestamptz
);

create index on queue_message (queue, visible_at) where deleted_at is null;

create table runner_event (
  id            bigint generated always as identity primary key,
  submission_id bigint references submission(id),
  level         text not null,
  message       text not null,
  detail        jsonb,
  created_at    timestamptz not null default now()
);

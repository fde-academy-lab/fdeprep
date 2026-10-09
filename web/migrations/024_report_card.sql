-- The report card. docs/11 section 3, story S15.6.
--
-- A dated snapshot of one learner for a placement team, which must keep
-- meaning what it meant after somebody has it in their inbox. So a card is a
-- row that never changes: issuing again writes a new row beside it, and an
-- update is refused by the trigger below.
--
-- content holds the snapshot as canonical JSON (keys sorted, no whitespace),
-- exactly the bytes content_sha256 was computed over, and the check makes the
-- database refuse a row whose hash is not its content's. The snapshot carries
-- no clock time, so two cards issued from unchanged data hash the same;
-- generated_at is when this one was issued.
--
-- Additive only: a new table, a function and a trigger, so the previous
-- release runs unchanged against this schema.

create table report_card (
  id              bigint generated always as identity primary key,
  enrolment_id    bigint not null references enrolment (id),
  cohort_id       bigint not null references cohort (id),
  -- Who issued it. Null only for a card a script issued with nobody signed in.
  issued_by       bigint references app_user (id),
  generated_at    timestamptz not null default now(),
  content         text not null,
  content_sha256  text not null,
  check (content_sha256 = encode(sha256(convert_to(content, 'UTF8')), 'hex'))
);

-- The learner page lists a learner's cards, newest first.
create index report_card_enrolment_idx on report_card (enrolment_id, generated_at desc);

create function report_card_never_changes() returns trigger
language plpgsql as $$
begin
  raise exception 'A report card never changes once issued. Issue a new one instead.';
end
$$;

create trigger report_card_never_changes
  before update on report_card
  for each row execute function report_card_never_changes();

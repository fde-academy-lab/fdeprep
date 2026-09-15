-- Phase 6: rehearsal, admin and ops.
--
-- rehearsal is docs/02 section 8 verbatim.
create table rehearsal (
  id            bigint generated always as identity primary key,
  enrolment_id  bigint not null references enrolment(id),
  started_at    timestamptz not null default now(),
  ends_at       timestamptz not null,
  finished_at   timestamptz,
  problem_ids   bigint[] not null,
  report        jsonb
);

create index on rehearsal (enrolment_id, started_at desc);

-- Which rehearsal a submission belongs to, so the report can find its own
-- verdicts without guessing from timestamps.
alter table submission add column rehearsal_id bigint references rehearsal(id);
create index on submission (rehearsal_id) where rehearsal_id is not null;

-- docs/02 section 2 defines persona_change and no migration ever created it,
-- because nothing changed a persona until this phase. The roster upload does.
create table persona_change (
  id            bigint generated always as identity primary key,
  enrolment_id  bigint not null references enrolment(id),
  from_persona  persona not null,
  to_persona    persona not null,
  changed_by    bigint references app_user(id),
  changed_at    timestamptz not null default now()
);

create index on persona_change (enrolment_id, changed_at desc);

-- Runtime switches an operator can throw without a deploy.
--
-- docs/05 section 8 names the operations risk: one operator who is also
-- teaching. Degraded mode is the control for the Tuesday evening in that
-- paragraph, and a control that needs a deploy to reach is not available on a
-- Tuesday evening. docs/02 describes no table for this, so this shape is this
-- build's own.
create table platform_setting (
  key         text primary key,
  value       jsonb not null,
  reason      text,
  updated_by  bigint references app_user(id),
  updated_at  timestamptz not null default now()
);

insert into platform_setting (key, value) values ('degraded_mode', 'false'::jsonb);

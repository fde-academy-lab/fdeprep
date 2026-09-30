-- Invites, for a beta with testers outside the GitHub organisation.
-- docs/00 section 2 and docs/02, amended 30 September 2026.
--
-- An invite is a one-time link an admin sends by hand. Redeeming it through
-- the GitHub sign-in creates, or reactivates, an enrolment in the invite's
-- cohort with the invite's role and persona. Only a SHA-256 of the token is
-- stored, so a copy of this table lets nobody in.
--
-- A new table and nothing else, so the previous release runs unchanged
-- against this schema.
create table if not exists invite (
  id            bigint generated always as identity primary key,
  token_sha256  text not null unique,
  cohort_id     bigint not null references cohort(id),
  role          app_role not null default 'learner',
  persona       persona not null default 'navigator',
  -- When set, only this GitHub login may redeem it, compared without case.
  github_login  text,
  -- Who it is for, in the admin's words. Shown to admins and nobody else.
  note          text,
  -- Null only for an invite minted on the host with `npm run invite`, which is
  -- how the first admin gets in before anyone can sign in to make one.
  created_by    bigint references app_user(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       bigint references app_user(id),
  revoked_at    timestamptz,
  check (used_at is null or used_by is not null)
);

create index if not exists invite_cohort on invite (cohort_id, created_at desc);

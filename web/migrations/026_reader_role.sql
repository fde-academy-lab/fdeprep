-- A database role that reads every table and writes none. docs/11 section 8,
-- docs/12 section 6, story S15.7.
--
-- The enforced boundary is web/tests/writer-boundary.test.ts, which fails when
-- a file outside lib/eval/ writes a grade, a band or a competency state. This
-- role is the second line behind it: a connection made as fdeprep_reader
-- cannot write evaluation, evaluation_review, competency_score, submission or
-- anything else, whatever SQL it is handed. The application does not switch
-- to it at run time in this release; progress/ and analytics/ still run under
-- the application's own user.
--
-- A role belongs to the whole Postgres cluster, and creating one needs
-- CREATEROLE, which a hosted Postgres may not give the user that runs the
-- migrations. So the role is created only when that user may create roles.
-- Otherwise this migration changes nothing and raises a notice saying so,
-- because a deploy that fails over a second line of defence is worse than the
-- second line missing. Granting SELECT to a role that already exists needs no
-- CREATEROLE, so that half runs whenever the role is there.
--
-- Additive only: nothing existing is altered, so the previous release runs
-- unchanged against this schema.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fdeprep_reader') then
    if not exists (select 1 from pg_roles
                    where rolname = current_user and (rolcreaterole or rolsuper)) then
      raise notice '%', format(
        'fdeprep_reader was not created, because %s may not create roles, and '
        || 'nothing changed. The application runs without it. To add it later, a user with '
        || 'CREATEROLE runs "create role fdeprep_reader nologin", and the owner of the tables '
        || 'runs the three grants at the end of web/migrations/026_reader_role.sql.',
        current_user);
      return;
    end if;
    create role fdeprep_reader nologin;
  end if;

  grant usage on schema public to fdeprep_reader;
  grant select on all tables in schema public to fdeprep_reader;
  -- Tables a later migration creates, run by this same user, are readable too.
  alter default privileges in schema public grant select on tables to fdeprep_reader;
end
$$;

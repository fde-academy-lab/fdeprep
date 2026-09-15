-- The voice caps from docs/07 section 10.
--
-- Separate from 012 because Postgres will not let a value added to an enum in
-- one transaction be used in that same transaction, and every migration here
-- runs inside one. So 012 adds the two scopes and this inserts the rows.
--
-- Pressure is not here. Section 10 caps it at "2 per week, shared with the
-- rehearsal allowance", so it spends rehearsal_weekly, which already exists
-- and is already seeded. A second row of its own would be a second budget.

-- rate_limit_policy_key is a unique index rather than a named constraint, and
-- it is declared "nulls not distinct", so an ON CONFLICT clause here would
-- have to infer it. A guard on the scope says the same thing and reads as
-- what it means.
insert into rate_limit_policy (scope, difficulty, max_count, window_s)
select scope, null::difficulty, max_count, window_s
  from (values
    ('voice_guided_daily'::limit_scope,   6, 86400),
    ('voice_unguided_daily'::limit_scope, 6, 86400)
  ) as wanted(scope, max_count, window_s)
 where not exists (
   select 1 from rate_limit_policy existing
    where existing.scope = wanted.scope and existing.difficulty is null
      and existing.cohort_id is null);

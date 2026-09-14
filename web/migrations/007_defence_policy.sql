-- The defence allowance, separate from 006 because Postgres refuses to use a
-- new enum value in the transaction that added it.
--
-- A defence is asked only after a pass, so it never competes with the submit
-- cap. It still spends a model call per attempt, which is why it has a cap of
-- its own rather than none.
insert into rate_limit_policy (scope, difficulty, max_count, window_s)
values ('defence_daily', null, 5, 86400)
on conflict (scope, difficulty, cohort_id) do nothing;

import type { Pool, PoolClient } from "pg";

/**
 * The seed policy from docs/02 section 6.
 *
 * Migration 003 holds the same rows, because a migration is a historical
 * record and must not import code that can change under it. This copy exists
 * so a test that truncates can put the policy back: rate_limit_policy has a
 * foreign key to cohort, so `truncate cohort cascade` takes the policy with
 * it, which silently disables every cap.
 */
export async function seedRateLimitPolicies(client: Pool | PoolClient): Promise<void> {
  await client.query(`
    insert into rate_limit_policy (scope, difficulty, max_count, window_s) values
      ('run_hourly',       null,      30,   3600),
      ('submit_daily',     'easy',    1000, 86400),
      ('submit_daily',     'medium',  10,   86400),
      ('submit_daily',     'hard',    5,    86400),
      ('submit_daily',     'extreme', 1,    86400),
      ('live_daily',       null,      10,   86400),
      ('rehearsal_weekly', null,      2,    604800),
      ('defence_daily',    null,      5,    86400),
      -- docs/07 section 10. Pressure is absent on purpose: it spends
      -- rehearsal_weekly, which that section says it shares.
      ('voice_guided_daily',   null,  6,    86400),
      ('voice_unguided_daily', null,  6,    86400)
    on conflict do nothing`);
}

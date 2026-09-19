import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The "@/" alias from tsconfig.json. Vitest infers it while there is no
  // config file and stops once there is one, so declaring a config means
  // declaring this too, or every import of "@/lib/..." fails to resolve.
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    /**
     * Test files run one at a time.
     *
     * Six of them share one database and each calls resetDatabase, which is a
     * `truncate ... cascade` over every table. Run in parallel, that truncate
     * asks for an AccessExclusiveLock while another file's dispatcher holds a
     * row lock on `outbox`, and Postgres kills one of them:
     *
     *   Process 109: truncate outbox, queue_message, ... restart identity cascade
     *   Process 108: update outbox set sent_at = now() where id = $1
     *
     * That is a deadlock between two test files, not a flake, and it fires on
     * whichever run happens to interleave badly. The alternative is a database
     * per worker, which is worth doing when the suite gets slow enough to care;
     * at this size serialising costs a few seconds and removes the race
     * outright.
     */
    fileParallelism: false,
    /**
     * The suite predates sign-in and calls route handlers directly, with no
     * request scope and so no cookie. This is the same switch a developer sets
     * to run the platform on a laptop without a GitHub OAuth application, and
     * lib/auth/config.ts refuses it whenever one is configured or NODE_ENV is
     * production, so it cannot follow the code into a deployment.
     */
    env: { AUTH_DEV_LEARNER: "1" },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The database tests share one Postgres schema, so they run in one file at
    // a time rather than racing each other through the same tables.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
});

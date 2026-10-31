import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // PostgreSQL integration suites share the local chain/DB state machine in
    // strict order — parallel files would interleave checkpoints. Run them one
    // at a time, always.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});

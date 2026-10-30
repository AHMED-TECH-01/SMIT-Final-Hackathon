import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup-env.ts'],
    // MongoDB Memory Server needs a generous first-run budget to download
    // and boot a mongod binary.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // DB-backed suites share one in-memory server; run files sequentially
    // to keep them deterministic.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})

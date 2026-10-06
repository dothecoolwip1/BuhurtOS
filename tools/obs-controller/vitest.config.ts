import { defineConfig } from 'vitest/config';

// The tool's own test run (the root vitest config also includes tools/**/*.test.ts). Tests that need the built bundle or the stand-in start them themselves.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 }
});

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * End-to-end: the real API against a real, freshly seeded database. Files run
 * one at a time because they share that database.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@grabgo/types': resolve(__dirname, '../../packages/types/src/index.ts'),
      '@grabgo/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      '@grabgo/config': resolve(__dirname, '../../packages/config/src/index.ts'),
      '@grabgo/validation': resolve(__dirname, '../../packages/validation/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    setupFiles: ['e2e/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

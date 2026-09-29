import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

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
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});

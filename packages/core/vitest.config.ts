import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Alias @grabgo/types to its TypeScript source so `npm test` works on a clean
// checkout without having to build the packages first.
export default defineConfig({
  resolve: {
    alias: {
      '@grabgo/types': resolve(__dirname, '../types/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

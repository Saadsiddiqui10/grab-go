import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@grabgo/types': resolve(__dirname, '../types/src/index.ts') },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});

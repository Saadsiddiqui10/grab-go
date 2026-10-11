import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /**
   * The @grabgo/* packages are compiled to CommonJS so the Node API and Metro
   * can consume them directly. Vite's dev server serves native ESM and cannot
   * read named exports from a *linked* CJS package, so they are forced through
   * the dependency optimiser, which converts them to ESM up front.
   *
   * Without this the dev server renders a blank page with
   * "does not provide an export named ...", while the production build works —
   * because Rollup handles CJS interop during bundling.
   */
  optimizeDeps: {
    include: [
      '@grabgo/types',
      '@grabgo/core',
      '@grabgo/config',
      '@grabgo/validation',
      '@grabgo/ui',
    ],
  },
  server: {
    port: 5173,
    // The API runs on its own port in development; proxying keeps the browser
    // on one origin so cookies and CORS behave like production.
    proxy: {
      // GRABGO_API_ORIGIN lets the browser tests point a dashboard at their
      // own API instance (and database) without touching the dev one.
      '/api': { target: process.env.GRABGO_API_ORIGIN ?? 'http://localhost:4000', changeOrigin: true },
      '/realtime': {
        target: process.env.GRABGO_API_ORIGIN ?? 'http://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});

import { defineConfig, devices } from '@playwright/test';
import { e2eDatabaseUrl } from '../apps/api/e2e/global-setup';

/**
 * Browser tests for the two dashboards.
 *
 * Playwright starts its own API on :4100 against the `grabgo_e2e` database
 * (prepared by the API suite's setup: migrated, seeded, leftovers closed) and
 * both dashboards on :5273 / :5274 pointed at it, so it runs alongside a
 * development session without touching it.
 */
const API = 'http://localhost:4100';
const database = e2eDatabaseUrl();

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The café board lives on an iPad by the till.
    { name: 'ipad', use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium' }, testMatch: /board/ },
  ],
  webServer: [
    {
      command: 'npx tsx apps/api/src/index.ts',
      cwd: '..',
      url: `${API}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: database,
        PORT: '4100',
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
        JOBS_ENABLED: 'false',
        PUSH_ENABLED: 'false',
        AUTH_SECRET: 'web-e2e-auth-secret-0123456789abcdefghijklmn',
        PICKUP_TOKEN_SECRET: 'web-e2e-pickup-secret-0123456789abcdefghijk',
        PAYMENT_PROVIDER: 'mock',
        SMS_PROVIDER: 'mock',
        CORS_ORIGINS: '*',
        TRUST_PROXY_HOPS: '1',
      },
    },
    {
      command: 'npx vite --port 5273 --strictPort',
      cwd: '../apps/merchant-dashboard',
      // Vite logs every live-order socket a closing test tab drops (EPIPE).
      // A dashboard that fails to start still fails the run: Playwright waits
      // for its URL.
      stderr: 'ignore',
      url: 'http://localhost:5273',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { GRABGO_API_ORIGIN: API },
    },
    {
      command: 'npx vite --port 5274 --strictPort',
      cwd: '../apps/admin-dashboard',
      stderr: 'ignore',
      url: 'http://localhost:5274',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { GRABGO_API_ORIGIN: API },
    },
  ],
});

export const URLS = { api: `${API}/api/v1`, merchant: 'http://localhost:5273', admin: 'http://localhost:5274' };

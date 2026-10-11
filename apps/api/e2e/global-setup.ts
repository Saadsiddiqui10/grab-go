import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * End-to-end suite setup.
 *
 * The suite runs the real API (routes, services, Prisma) against a real
 * Postgres database of its own: `grabgo_e2e` next to the development database,
 * or `E2E_DATABASE_URL`, so development data is never touched.
 *
 * Nothing is dropped between runs. Pending migrations are applied and the seed
 * (which only upserts) is re-run, and every test creates its own customers, so
 * leftovers from earlier runs cannot change an outcome. Tests that change a
 * café's settings put them back. To start from empty, drop the database by
 * hand; it is recreated on the next run.
 *
 * As a guard it still refuses any database whose name does not end in `_e2e`.
 */

const API_ROOT = resolve(__dirname, '..');

export function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;

  const envFile = resolve(API_ROOT, '.env');
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('Set E2E_DATABASE_URL (or DATABASE_URL in apps/api/.env) to run the e2e suite.');
  }

  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, '').replace(/_e2e$/, '')}_e2e`.replace(/^/, '/');
  return url.toString();
}

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

async function ensureDatabase(url: string): Promise<void> {
  const name = databaseName(url);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    const rows = await client.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS "exists"`;
    if (!rows[0]?.exists) {
      // Identifiers cannot be parameters; the name was validated below.
      await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await client.$disconnect();
  }
}

export default async function setup(): Promise<void> {
  const url = e2eDatabaseUrl();
  const name = databaseName(url);
  if (!/^[a-z0-9_]+_e2e$/i.test(name)) {
    throw new Error(`Refusing to use "${name}": the e2e database name must end in _e2e.`);
  }

  await ensureDatabase(url);

  const env = { ...process.env, DATABASE_URL: url };
  const run = (args: string[]): void => {
    execFileSync('npx', args, { cwd: API_ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
  };

  run(['prisma', 'migrate', 'deploy']);
  run(['tsx', 'prisma/seed.ts']);

  // Seeded cafés trade 08:00–23:00. Open them round the clock here so the
  // suite passes at 2am too; opening hours have their own unit tests.
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await db.businessHour.updateMany({ data: { opensAt: 0, closesAt: 0, isClosed: false } });
    // Orders a previous run left open would count against cafés' capacity
    // and crowd their boards; close them out, as the expiry job would.
    await db.order.updateMany({
      where: { status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'] } },
      data: { status: 'EXPIRED', cancelledAt: new Date() },
    });
  } finally {
    await db.$disconnect();
  }

  process.env.E2E_DATABASE_URL = url;
}

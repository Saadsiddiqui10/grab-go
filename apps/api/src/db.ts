import { PrismaClient } from '@prisma/client';
import { getEnv } from './env';

/**
 * The Prisma client.
 *
 * A single instance per process: Prisma manages its own connection pool, and a
 * client per request would exhaust Postgres connections under any real load.
 * Cached on `globalThis` so `tsx watch` reloads do not leak pools in development.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function createPrismaClient(): PrismaClient {
  const env = getEnv();

  return new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type Db = PrismaClient;

/**
 * A transactional client.
 *
 * Services accept this so a caller can compose several of them into one atomic
 * unit — creating an order, writing its points ledger entry and marking a
 * referral qualified must all commit together or not at all.
 */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export type DbOrTx = Db | Tx;

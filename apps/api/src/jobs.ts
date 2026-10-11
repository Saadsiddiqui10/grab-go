import { prisma } from './db';
import { getEnv } from './env';
import { getPlatformConfig } from './services/settings.service';
import { transitionOrder } from './services/order.service';

/**
 * Background maintenance.
 *
 * Deliberately a simple interval inside the API process rather than a queue: at
 * launch scale these sweeps are seconds of work, and an extra piece of
 * infrastructure to operate would cost more than it saves. Each task is
 * idempotent, so running it twice — or on two instances — is harmless.
 */

let timer: NodeJS.Timeout | null = null;

/**
 * Expire orders a cafe never acknowledged.
 *
 * Without this, a PENDING order sits forever: the customer waits for a coffee
 * nobody is making, and the cafe's board fills with stale tickets.
 */
export async function expireUnacceptedOrders(now = new Date()): Promise<number> {
  const platform = await getPlatformConfig(prisma);
  const cutoff = new Date(now.getTime() - platform.merchantAcceptWindowMinutes * 60_000);

  const stale = await prisma.order.findMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
    select: { id: true },
    take: 100,
  });

  let expired = 0;

  for (const order of stale) {
    try {
      await transitionOrder({
        orderId: order.id,
        to: 'EXPIRED',
        actor: { userId: 'system', type: 'SYSTEM' },
        note: 'The cafe did not accept this order in time.',
        now,
      });
      expired += 1;
    } catch (error) {
      // A race with a cafe accepting the order is expected; the state machine
      // refuses it and the sweep moves on.
      console.warn('[jobs] could not expire order', order.id, error);
    }
  }

  return expired;
}

/**
 * Retire points past their expiry date.
 *
 * Writes an EXPIRY ledger row rather than editing the original earn row, so the
 * history still shows what was earned and when it lapsed.
 */
export async function expireStalePoints(now = new Date()): Promise<number> {
  const lapsed = await prisma.pointsTransaction.findMany({
    where: {
      amount: { gt: 0 },
      expiresAt: { lt: now },
      expiredAt: null,
    },
    select: { id: true, userId: true, accountId: true, businessId: true, amount: true },
    take: 200,
  });

  let expired = 0;

  for (const entry of lapsed) {
    await prisma.$transaction(async (tx) => {
      const account = await tx.pointsAccount.findUnique({
        where: { id: entry.accountId },
        select: { balance: true },
      });

      // Only claw back what is still there: points already spent cannot expire.
      const amount = Math.min(entry.amount, account?.balance ?? 0);

      await tx.pointsTransaction.update({
        where: { id: entry.id },
        data: { expiredAt: now },
      });

      if (amount <= 0) return;

      const updated = await tx.pointsAccount.update({
        where: { id: entry.accountId },
        data: { balance: { decrement: amount } },
        select: { balance: true },
      });

      await tx.pointsTransaction.create({
        data: {
          accountId: entry.accountId,
          userId: entry.userId,
          businessId: entry.businessId,
          amount: -amount,
          type: 'EXPIRY',
          description: 'Points expired',
          referenceType: 'points_transaction',
          referenceId: entry.id,
          balanceAfter: updated.balance,
        },
      });
    });

    expired += 1;
  }

  return expired;
}

/** Drop refresh tokens that are long dead, so the table does not grow forever. */
export async function pruneExpiredSessions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const result = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });

  return result.count;
}

export async function runMaintenance(): Promise<void> {
  const results = await Promise.allSettled([
    expireUnacceptedOrders(),
    expireStalePoints(),
    pruneExpiredSessions(),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[jobs] maintenance task failed', result.reason);
    }
  }
}

export function startJobs(): void {
  const env = getEnv();
  if (!env.JOBS_ENABLED || timer) return;

  timer = setInterval(() => {
    void runMaintenance();
  }, env.JOB_INTERVAL_SECONDS * 1000);

  // Do not hold the process open just for maintenance.
  timer.unref();
}

export function stopJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

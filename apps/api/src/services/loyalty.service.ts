import {
  checkRedeemable,
  computePointsEarned,
  computePointsProgress,
  pointsExpiryDate,
  type RewardRule,
} from '@grabgo/core';
import type {
  PointsAccountSummary,
  PointsTransaction,
  Reward,
  RewardRedemption,
} from '@grabgo/types';
import type { PointsTransactionType, Prisma } from '@prisma/client';
import type { DbOrTx, Tx } from '../db';
import { prisma } from '../db';
import { expect, HttpError, notFound } from '../lib/http-error';
import { shortCode } from '../lib/crypto';
import { toPointsTransaction, toRedemption, toReward } from '../mappers';
import { getLoyaltyConfig } from './settings.service';

/**
 * Grab Points.
 *
 * Every movement is a ledger row. The cached balance on `PointsAccount` is only
 * ever written in the same transaction as the row that moved it, and a spend is
 * a conditional update (`balance >= amount`) rather than a read-then-write — so
 * two concurrent redemptions cannot both succeed against the same points.
 *
 * There is deliberately no exported function that lets a request body specify an
 * arbitrary points award. Callers pass an *event* (an order collected, a referral
 * qualified) and this service derives the amount.
 */

export interface PointsDelta {
  userId: string;
  amount: number;
  type: PointsTransactionType;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  orderId?: string | null;
  expiresAt?: Date | null;
}

export async function ensurePointsAccount(tx: Tx, userId: string): Promise<string> {
  const account = await tx.pointsAccount.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  });
  return account.id;
}

/**
 * Move points and write the matching ledger row, atomically.
 *
 * Returns null when the caller asked for a duplicate award that the unique
 * `(orderId, type)` index rejects — that is the idempotency guard doing its job,
 * not an error worth failing an order over.
 */
export async function applyPointsDelta(
  tx: Tx,
  delta: PointsDelta,
): Promise<{ balanceAfter: number; transactionId: string } | null> {
  if (delta.amount === 0) return null;

  const accountId = await ensurePointsAccount(tx, delta.userId);

  if (delta.amount < 0) {
    const spend = Math.abs(delta.amount);
    // Conditional decrement: the WHERE clause is the balance check, so it cannot
    // be raced between reading and writing.
    const updated = await tx.pointsAccount.updateMany({
      where: { id: accountId, balance: { gte: spend } },
      data: {
        balance: { decrement: spend },
        lifetimeRedeemed:
          delta.type === 'REWARD_REDEMPTION' ? { increment: spend } : undefined,
      },
    });

    if (updated.count === 0) {
      throw new HttpError(
        'INSUFFICIENT_POINTS',
        'You do not have enough Grab Points for this.',
      );
    }
  } else {
    await tx.pointsAccount.update({
      where: { id: accountId },
      data: {
        balance: { increment: delta.amount },
        lifetimeEarned: { increment: delta.amount },
      },
    });
  }

  const account = await tx.pointsAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: { balance: true },
  });

  try {
    const transaction = await tx.pointsTransaction.create({
      data: {
        accountId,
        userId: delta.userId,
        amount: delta.amount,
        type: delta.type,
        description: delta.description,
        referenceType: delta.referenceType ?? null,
        referenceId: delta.referenceId ?? null,
        orderId: delta.orderId ?? null,
        balanceAfter: account.balance,
        expiresAt: delta.expiresAt ?? null,
      },
      select: { id: true },
    });

    return { balanceAfter: account.balance, transactionId: transaction.id };
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      // Already awarded for this order; undo the balance move we just made.
      await tx.pointsAccount.update({
        where: { id: accountId },
        data: {
          balance: { decrement: delta.amount },
          lifetimeEarned: delta.amount > 0 ? { decrement: delta.amount } : undefined,
        },
      });
      return null;
    }
    throw error;
  }
}

/**
 * Award points for a collected order.
 *
 * Called from the order state machine, never from a route. The amount comes from
 * the order's own stored totals and the loyalty config in force.
 */
export async function awardOrderPoints(
  tx: Tx,
  order: {
    id: string;
    userId: string;
    orderNumber: string;
    subtotal: number;
    discountTotal: number;
  },
): Promise<number> {
  const config = await getLoyaltyConfig(tx);
  if (!config.isEnabled) return 0;

  const points = computePointsEarned(
    { subtotal: order.subtotal, discountTotal: order.discountTotal },
    config,
  );

  if (points <= 0) return 0;

  const now = new Date();
  const result = await applyPointsDelta(tx, {
    userId: order.userId,
    amount: points,
    type: 'ORDER_EARNED',
    description: `Order ${order.orderNumber}`,
    referenceType: 'order',
    referenceId: order.id,
    orderId: order.id,
    expiresAt: pointsExpiryDate(now, config),
  });

  if (!result) return 0;

  await tx.order.update({
    where: { id: order.id },
    data: { pointsEarned: points, pointsAwardedAt: now },
  });

  return points;
}

/** Claw back points when an order is refunded after they were granted. */
export async function reverseOrderPoints(
  tx: Tx,
  orderId: string,
  reason: string,
): Promise<void> {
  const earned = await tx.pointsTransaction.findFirst({
    where: { orderId, type: 'ORDER_EARNED' },
  });

  if (!earned || earned.amount <= 0) return;

  const alreadyReversed = await tx.pointsTransaction.findFirst({
    where: { orderId, type: 'REFUND_REVERSAL' },
  });
  if (alreadyReversed) return;

  // Unconditional decrement, unlike a redemption: if the customer has already
  // spent the points from an order they then got refunded, the balance goes
  // negative. That is the honest state, and it is recoverable as they earn again.
  const accountId = await ensurePointsAccount(tx, earned.userId);
  const account = await tx.pointsAccount.update({
    where: { id: accountId },
    data: { balance: { decrement: earned.amount } },
    select: { balance: true },
  });

  await tx.pointsTransaction.create({
    data: {
      accountId,
      userId: earned.userId,
      amount: -earned.amount,
      type: 'REFUND_REVERSAL',
      description: reason,
      referenceType: 'order',
      referenceId: orderId,
      orderId,
      balanceAfter: account.balance,
    },
  });
}

/* -------------------------------------------------------------------- reading */

export async function getPointsSummary(
  db: DbOrTx,
  userId: string,
): Promise<PointsAccountSummary> {
  const [account, rewards] = await Promise.all([
    db.pointsAccount.findUnique({ where: { userId } }),
    db.reward.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { pointsRequired: 'asc' },
      select: { id: true, name: true, pointsRequired: true },
    }),
  ]);

  const balance = account?.balance ?? 0;
  const progress = computePointsProgress(
    balance,
    rewards.map((reward) => ({
      rewardId: reward.id,
      name: reward.name,
      pointsRequired: reward.pointsRequired,
    })),
  );

  return {
    balance,
    lifetimeEarned: account?.lifetimeEarned ?? 0,
    lifetimeRedeemed: account?.lifetimeRedeemed ?? 0,
    nextReward: progress.nextReward,
    pointsToNextReward: progress.pointsToNextReward,
    progressToNextReward: progress.progressToNextReward,
  };
}

export async function listPointsTransactions(
  db: DbOrTx,
  userId: string,
  options: { cursor?: string | null; limit: number },
): Promise<{ items: PointsTransaction[]; nextCursor: string | null; hasMore: boolean }> {
  const rows = await db.pointsTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > options.limit;
  const items = hasMore ? rows.slice(0, options.limit) : rows;

  return {
    items: items.map(toPointsTransaction),
    hasMore,
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function listRewards(
  db: DbOrTx,
  userId: string | null,
  businessId?: string | null,
): Promise<Reward[]> {
  // Both conditions are OR groups, so they go under AND rather than overwriting
  // each other on a single `OR` key.
  const where: Prisma.RewardWhereInput = {
    isActive: true,
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      ...(businessId ? [{ OR: [{ businessId: null }, { businessId }] }] : []),
    ],
  };

  const [rewards, account] = await Promise.all([
    db.reward.findMany({
      where,
      include: { business: { select: { name: true } } },
      orderBy: { pointsRequired: 'asc' },
    }),
    userId
      ? db.pointsAccount.findUnique({ where: { userId }, select: { balance: true } })
      : Promise.resolve(null),
  ]);

  const balance = account?.balance ?? 0;
  return rewards.map((reward) => toReward(reward, balance));
}

/* ------------------------------------------------------------------ redeeming */

/**
 * Spend points for a reward.
 *
 * The points leave the account here, at redemption time, not at checkout: the
 * customer gets a code they own and can spend on any qualifying order.
 */
export async function redeemReward(
  userId: string,
  rewardId: string,
  businessId: string | null,
): Promise<RewardRedemption> {
  return prisma.$transaction(async (tx) => {
    const reward = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!reward || !reward.isActive) throw notFound('That reward');

    const account = await tx.pointsAccount.findUnique({
      where: { userId },
      select: { balance: true },
    });

    const rule: RewardRule = {
      id: reward.id,
      name: reward.name,
      type: reward.type,
      pointsRequired: reward.pointsRequired,
      discountAmount: reward.discountAmount,
      discountPercentage: reward.discountPercentage,
      maxDiscountAmount: reward.maxDiscountAmount,
      freeItemMenuItemIds: reward.freeItemMenuItemIds,
      businessId: reward.businessId,
      expiresAt: reward.expiresAt,
      isActive: reward.isActive,
      usageLimit: reward.usageLimit,
      usageCount: reward.usageCount,
    };

    expect(
      checkRedeemable(rule, {
        now: new Date(),
        balance: account?.balance ?? 0,
        businessId,
      }),
    );

    await applyPointsDelta(tx, {
      userId,
      amount: -reward.pointsRequired,
      type: 'REWARD_REDEMPTION',
      description: `Redeemed: ${reward.name}`,
      referenceType: 'reward',
      referenceId: reward.id,
    });

    // Respect a global claim limit even under concurrency.
    if (reward.usageLimit !== null) {
      const claimed = await tx.reward.updateMany({
        where: { id: reward.id, usageCount: { lt: reward.usageLimit } },
        data: { usageCount: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new HttpError('REWARD_UNAVAILABLE', 'This reward has been fully claimed.');
      }
    } else {
      await tx.reward.update({
        where: { id: reward.id },
        data: { usageCount: { increment: 1 } },
      });
    }

    const redemption = await tx.rewardRedemption.create({
      data: {
        userId,
        rewardId: reward.id,
        pointsSpent: reward.pointsRequired,
        code: shortCode(8),
        status: 'ISSUED',
        // A redeemed reward is usable for 90 days, so points cannot be parked
        // indefinitely in an unspent code.
        expiresAt:
          reward.expiresAt ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
      include: { reward: { select: { name: true } } },
    });

    return toRedemption(redemption);
  });
}

/** Mark a redemption spent, once the order it discounted is placed. */
export async function consumeRedemption(
  tx: Tx,
  redemptionId: string,
  orderId: string,
): Promise<void> {
  const updated = await tx.rewardRedemption.updateMany({
    where: { id: redemptionId, status: { in: ['ISSUED', 'APPLIED'] } },
    data: { status: 'CONSUMED', consumedAt: new Date() },
  });

  if (updated.count === 0) {
    throw new HttpError('REDEMPTION_INVALID', 'That reward has already been used.');
  }

  await tx.order.update({ where: { id: orderId }, data: { redemptionId } });
}

/** Give a redemption back when the order that consumed it is cancelled. */
export async function releaseRedemption(tx: Tx, redemptionId: string): Promise<void> {
  await tx.rewardRedemption.updateMany({
    where: { id: redemptionId, status: 'CONSUMED' },
    data: { status: 'ISSUED', consumedAt: null },
  });
}

export async function listRedemptions(
  db: DbOrTx,
  userId: string,
): Promise<RewardRedemption[]> {
  const rows = await db.rewardRedemption.findMany({
    where: { userId, status: { in: ['ISSUED', 'APPLIED'] } },
    include: { reward: { select: { name: true } }, order: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return rows.map(toRedemption);
}

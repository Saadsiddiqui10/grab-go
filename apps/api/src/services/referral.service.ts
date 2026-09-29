import {
  checkReferralClaim,
  evaluateReferralQualification,
  normalizeReferralCode,
} from '@grabgo/core';
import { deepLinks, referralShareMessage } from '@grabgo/config';
import type { ReferralProgress } from '@grabgo/types';
import type { DbOrTx, Tx } from '../db';
import { shortCode } from '../lib/crypto';
import { applyPointsDelta } from './loyalty.service';
import { getReferralConfig } from './settings.service';

/**
 * Referrals.
 *
 * The rule the whole system turns on: **signing up is not qualifying**. A
 * referral moves PENDING -> QUALIFIED only when the invited person has paid for
 * and collected a real order that clears the configured minimum. Everything else
 * here exists to make that rule hard to game.
 */

export interface ReferralClaimContext {
  refereeId: string;
  code: string;
  deviceId?: string | null;
  ipHash?: string | null;
}

/**
 * Attach a referral at signup.
 *
 * Never throws: a bad or abusive code must not block someone from creating an
 * account. It returns whether the referral was recorded so the caller can decide
 * what to tell the user.
 */
export async function attachReferralAtSignup(
  tx: Tx,
  context: ReferralClaimContext,
): Promise<{ attached: boolean; reason?: string }> {
  const config = await getReferralConfig(tx);
  if (!config.isEnabled) return { attached: false, reason: 'Referrals are disabled.' };

  const code = normalizeReferralCode(context.code);
  const referrer = await tx.user.findUnique({
    where: { referralCode: code },
    select: { id: true, status: true },
  });

  const existing = await tx.referral.findUnique({
    where: { refereeId: context.refereeId },
    select: { id: true },
  });

  // Count prior signups from this device: the cheapest way to farm referrals is
  // a stack of throwaway accounts on one phone.
  const duplicateDeviceSignups = context.deviceId
    ? await tx.referral.count({ where: { deviceId: context.deviceId } })
    : 0;

  const check = checkReferralClaim({
    referrerId: referrer && referrer.status === 'ACTIVE' ? referrer.id : null,
    refereeId: context.refereeId,
    refereeAlreadyReferred: existing !== null,
    duplicateDeviceSignups,
  });

  if (!check.ok) return { attached: false, reason: check.message };

  await tx.referral.create({
    data: {
      referrerId: check.value.referrerId,
      refereeId: context.refereeId,
      code,
      status: 'PENDING',
      deviceId: context.deviceId ?? null,
      ipHash: context.ipHash ?? null,
    },
  });

  await tx.user.update({
    where: { id: context.refereeId },
    data: { referredById: check.value.referrerId },
  });

  // The welcome reward is granted immediately — it costs the platform nothing
  // until the new customer actually orders, and it is what makes the invite
  // worth accepting.
  if (config.refereeSignupPoints > 0) {
    await applyPointsDelta(tx, {
      userId: context.refereeId,
      amount: config.refereeSignupPoints,
      type: 'REFERRAL_BONUS',
      description: 'Welcome bonus for joining with a friend’s code',
      referenceType: 'referral',
      referenceId: check.value.referrerId,
    });
  }

  if (config.refereeRewardId) {
    await issueReferralReward(tx, {
      referralId: (await tx.referral.findUniqueOrThrow({
        where: { refereeId: context.refereeId },
        select: { id: true },
      })).id,
      userId: context.refereeId,
      rewardId: config.refereeRewardId,
      kind: 'REFEREE',
    });
  }

  return { attached: true };
}

/**
 * Evaluate a referral when the referred user's order reaches a qualifying status.
 *
 * Best-effort by design: this runs inside order completion, and a referral that
 * cannot be settled must never fail the order it rode in on.
 */
export async function evaluateReferralOnOrder(
  tx: Tx,
  order: { id: string; userId: string; total: number; status: string },
): Promise<{ qualified: boolean }> {
  const config = await getReferralConfig(tx);
  if (!config.isEnabled) return { qualified: false };

  const referral = await tx.referral.findUnique({
    where: { refereeId: order.userId },
  });
  if (!referral || referral.status !== 'PENDING') return { qualified: false };

  const referee = await tx.user.findUnique({
    where: { id: order.userId },
    select: { phoneVerifiedAt: true },
  });

  // "First qualifying order" means no earlier order of theirs already reached a
  // qualifying status — otherwise a referral could be held back and cashed in later.
  const earlierQualifying = await tx.order.count({
    where: {
      userId: order.userId,
      id: { not: order.id },
      status: { in: ['PICKED_UP', 'COMPLETED'] },
    },
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [qualifiedLast30Days, qualifiedTotal] = await Promise.all([
    tx.referral.count({
      where: {
        referrerId: referral.referrerId,
        status: { in: ['QUALIFIED', 'REWARDED'] },
        qualifiedAt: { gte: thirtyDaysAgo },
      },
    }),
    tx.referral.count({
      where: {
        referrerId: referral.referrerId,
        status: { in: ['QUALIFIED', 'REWARDED'] },
      },
    }),
  ]);

  const outcome = evaluateReferralQualification({
    config,
    referralStatus: referral.status,
    orderStatus: order.status,
    orderTotal: order.total,
    isFirstQualifyingOrder: earlierQualifying === 0,
    refereePhoneVerified: referee?.phoneVerifiedAt !== null,
    referrerQualifiedLast30Days: qualifiedLast30Days,
    referrerQualifiedTotal: qualifiedTotal,
  });

  if (!outcome.qualifies) return { qualified: false };

  await tx.referral.update({
    where: { id: referral.id },
    data: {
      status: outcome.unlocksReferrerReward ? 'REWARDED' : 'QUALIFIED',
      qualifiedAt: new Date(),
      qualifyingOrderId: order.id,
      ...(outcome.unlocksReferrerReward ? { rewardedAt: new Date() } : {}),
    },
  });

  if (outcome.referrerPoints > 0) {
    await applyPointsDelta(tx, {
      userId: referral.referrerId,
      amount: outcome.referrerPoints,
      type: 'REFERRAL_BONUS',
      description: 'A friend you invited completed their first order',
      referenceType: 'referral',
      referenceId: referral.id,
    });
  }

  if (outcome.unlocksReferrerReward && config.referrerRewardId) {
    await issueReferralReward(tx, {
      referralId: referral.id,
      userId: referral.referrerId,
      rewardId: config.referrerRewardId,
      kind: 'REFERRER',
    });
  }

  return { qualified: true };
}

async function issueReferralReward(
  tx: Tx,
  input: {
    referralId: string;
    userId: string;
    rewardId: string;
    kind: 'REFERRER' | 'REFEREE';
  },
): Promise<void> {
  const reward = await tx.reward.findUnique({ where: { id: input.rewardId } });
  if (!reward || !reward.isActive) return;

  // A referral pays out at most once per side; the unique index is the guard, and
  // a duplicate attempt is ignored rather than raised.
  const already = await tx.referralReward.findUnique({
    where: { referralId_kind: { referralId: input.referralId, kind: input.kind } },
    select: { id: true },
  });
  if (already) return;

  const redemption = await tx.rewardRedemption.create({
    data: {
      userId: input.userId,
      rewardId: reward.id,
      // A gifted reward costs the recipient nothing.
      pointsSpent: 0,
      code: shortCode(8),
      status: 'ISSUED',
      expiresAt: reward.expiresAt ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });

  await tx.referralReward.create({
    data: {
      referralId: input.referralId,
      userId: input.userId,
      kind: input.kind,
      rewardRedemptionId: redemption.id,
    },
  });
}

/* ------------------------------------------------------------------- reading */

export async function getReferralProgress(
  db: DbOrTx,
  userId: string,
): Promise<ReferralProgress> {
  const [user, config, referrals] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    }),
    getReferralConfig(db),
    db.referral.findMany({
      where: { referrerId: userId },
      orderBy: { signedUpAt: 'desc' },
      take: 50,
      include: { referee: { select: { profile: { select: { fullName: true } } } } },
    }),
  ]);

  const pendingCount = referrals.filter((row) => row.status === 'PENDING').length;
  const qualifiedCount = referrals.filter(
    (row) => row.status === 'QUALIFIED' || row.status === 'REWARDED',
  ).length;
  const rewardedCount = referrals.filter((row) => row.status === 'REWARDED').length;

  return {
    code: user.referralCode,
    shareUrl: deepLinks.referral(user.referralCode),
    shareMessage: referralShareMessage(user.referralCode),
    pendingCount,
    qualifiedCount,
    rewardedCount,
    requiredForReward: config.referralsRequiredForReward,
    referrals: referrals.map((row) => ({
      id: row.id,
      // First name only: someone who accepted an invite has not agreed to have
      // their full name shown back to the person who invited them.
      refereeName: (row.referee.profile?.fullName ?? 'A friend').split(/\s+/)[0] ?? 'A friend',
      status: row.status,
      signedUpAt: row.signedUpAt.toISOString(),
      qualifiedAt: row.qualifiedAt?.toISOString() ?? null,
    })),
  };
}

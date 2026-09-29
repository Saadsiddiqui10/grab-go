import {
  RewardType,
  type LoyaltyConfig,
  type Paisa,
  type PointsTransactionType,
  type RewardType as RewardTypeT,
} from '@grabgo/types';
import { clampDiscount, percentOf } from './money';
import { fail, ok, type Result } from './errors';

/**
 * Grab Points.
 *
 * A balance is *never* a column that gets incremented. It is the sum of an
 * append-only ledger, which means every point in the system can be traced to the
 * order, referral or admin action that created it — and a double-award bug shows
 * up as two visible rows rather than as a silently wrong number.
 */

export interface PointsLedgerEntry {
  amount: number;
  type: PointsTransactionType;
  createdAt: Date;
  /** Set when the entry has expired and no longer counts toward the balance. */
  expiredAt?: Date | null;
}

export function computeBalance(entries: readonly PointsLedgerEntry[]): number {
  return entries.reduce((balance, entry) => balance + entry.amount, 0);
}

export function computeLifetimeEarned(entries: readonly PointsLedgerEntry[]): number {
  return entries
    .filter((entry) => entry.amount > 0)
    .reduce((total, entry) => total + entry.amount, 0);
}

export function computeLifetimeRedeemed(entries: readonly PointsLedgerEntry[]): number {
  return entries
    .filter((entry) => entry.amount < 0 && entry.type === 'REWARD_REDEMPTION')
    .reduce((total, entry) => total + Math.abs(entry.amount), 0);
}

/**
 * Points earned by an order.
 *
 * The rate, the basis (pre- or post-discount) and any promotional multiplier all
 * come from the admin-editable config — "Rs. 100 = 1 point" is a seeded default,
 * not a rule baked into this function.
 */
export function computePointsEarned(
  amounts: { subtotal: Paisa; discountTotal: Paisa },
  config: LoyaltyConfig,
): number {
  if (!config.isEnabled) return 0;
  if (config.earnRateAmount <= 0 || config.earnRatePoints <= 0) return 0;

  const basis =
    config.earnBasis === 'SUBTOTAL'
      ? amounts.subtotal
      : Math.max(0, amounts.subtotal - amounts.discountTotal);

  if (basis < config.minimumSpendForPoints) return 0;

  const units = Math.floor(basis / config.earnRateAmount);
  const multiplier = config.pointsMultiplier > 0 ? config.pointsMultiplier : 1;

  return Math.floor(units * config.earnRatePoints * multiplier);
}

export function pointsExpiryDate(earnedAt: Date, config: LoyaltyConfig): Date | null {
  if (config.expiryDays <= 0) return null;
  return new Date(earnedAt.getTime() + config.expiryDays * 24 * 60 * 60 * 1000);
}

/* --------------------------------------------------------------------- rewards */

export interface RewardRule {
  id: string;
  name: string;
  type: RewardTypeT;
  pointsRequired: number;
  /** Paisa, for FIXED_DISCOUNT. */
  discountAmount: Paisa | null;
  /** Percent, for PERCENTAGE_DISCOUNT. */
  discountPercentage: number | null;
  maxDiscountAmount: Paisa | null;
  /** Menu items this reward can be spent on, for FREE_ITEM. */
  freeItemMenuItemIds: string[];
  /** Null = redeemable at any cafe. */
  businessId: string | null;
  expiresAt: Date | null;
  isActive: boolean;
  usageLimit: number | null;
  usageCount: number;
}

export interface RedeemContext {
  now: Date;
  balance: number;
  businessId?: string | null;
}

/** Can this user turn points into this reward right now? */
export function checkRedeemable(
  reward: RewardRule,
  context: RedeemContext,
): Result<true> {
  if (!reward.isActive) {
    return fail('REWARD_UNAVAILABLE', 'This reward is no longer available.');
  }

  if (reward.expiresAt && context.now > reward.expiresAt) {
    return fail('REWARD_UNAVAILABLE', 'This reward has expired.');
  }

  if (reward.usageLimit !== null && reward.usageCount >= reward.usageLimit) {
    return fail('REWARD_UNAVAILABLE', 'This reward has been fully claimed.');
  }

  if (
    reward.businessId &&
    context.businessId &&
    reward.businessId !== context.businessId
  ) {
    return fail('REWARD_UNAVAILABLE', 'This reward can only be used at another cafe.');
  }

  if (context.balance < reward.pointsRequired) {
    const shortfall = reward.pointsRequired - context.balance;
    return fail(
      'INSUFFICIENT_POINTS',
      `You need ${shortfall} more Grab Point${shortfall === 1 ? '' : 's'} for this reward.`,
      { required: reward.pointsRequired, balance: context.balance, shortfall },
    );
  }

  return ok(true);
}

/** One priced basket line, reduced to what reward maths needs. */
export interface RewardableLine {
  menuItemId: string;
  unitPrice: Paisa;
  quantity: number;
  lineTotal: Paisa;
}

/**
 * Value of a redeemed reward against a specific basket.
 *
 * FREE_ITEM discounts a single unit of the most expensive eligible line: if a
 * customer redeems a free coffee on an order with a latte and an espresso, the
 * latte is the one that comes off.
 */
export function computeRewardDiscount(
  reward: RewardRule,
  lines: readonly RewardableLine[],
  discountableTotal: Paisa,
): Result<Paisa> {
  switch (reward.type) {
    case RewardType.FIXED_DISCOUNT: {
      const amount = reward.discountAmount ?? 0;
      return ok(clampDiscount(amount, discountableTotal));
    }

    case RewardType.PERCENTAGE_DISCOUNT: {
      const raw = percentOf(discountableTotal, reward.discountPercentage ?? 0);
      const capped =
        reward.maxDiscountAmount !== null
          ? Math.min(raw, reward.maxDiscountAmount)
          : raw;
      return ok(clampDiscount(capped, discountableTotal));
    }

    case RewardType.FREE_ITEM: {
      const eligible = lines.filter(
        (line) =>
          reward.freeItemMenuItemIds.length === 0 ||
          reward.freeItemMenuItemIds.includes(line.menuItemId),
      );

      if (eligible.length === 0) {
        return fail(
          'REDEMPTION_INVALID',
          'Add the free item to your cart to use this reward.',
        );
      }

      const best = eligible.reduce((highest, line) =>
        line.unitPrice > highest.unitPrice ? line : highest,
      );

      return ok(clampDiscount(best.unitPrice, discountableTotal));
    }

    default:
      return fail('REDEMPTION_INVALID', 'This reward cannot be applied.');
  }
}

/* -------------------------------------------------------------------- progress */

export interface RewardTier {
  rewardId: string;
  name: string;
  pointsRequired: number;
}

export interface PointsProgress {
  balance: number;
  nextReward: RewardTier | null;
  pointsToNextReward: number | null;
  /** 0..1, for the progress bar on the Rewards screen. */
  progressToNextReward: number;
}

/**
 * Where the user stands relative to the reward ladder.
 *
 * Progress is measured from the previous tier they have already cleared, so the
 * bar tells them how close the *next* reward is rather than restarting from zero.
 */
export function computePointsProgress(
  balance: number,
  tiers: readonly RewardTier[],
): PointsProgress {
  const ladder = [...tiers].sort((a, b) => a.pointsRequired - b.pointsRequired);
  const next = ladder.find((tier) => tier.pointsRequired > balance) ?? null;

  if (!next) {
    return {
      balance,
      nextReward: null,
      pointsToNextReward: null,
      progressToNextReward: 1,
    };
  }

  const previousThreshold = ladder
    .filter((tier) => tier.pointsRequired <= balance)
    .reduce((highest, tier) => Math.max(highest, tier.pointsRequired), 0);

  const span = next.pointsRequired - previousThreshold;
  const earnedInSpan = balance - previousThreshold;
  const progress = span <= 0 ? 1 : Math.min(1, Math.max(0, earnedInSpan / span));

  return {
    balance,
    nextReward: next,
    pointsToNextReward: next.pointsRequired - balance,
    progressToNextReward: progress,
  };
}

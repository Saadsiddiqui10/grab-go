import { describe, expect, it } from 'vitest';
import { DEFAULT_LOYALTY_CONFIG, type LoyaltyConfig } from '@grabgo/types';
import {
  checkRedeemable,
  computeBalance,
  computeLifetimeRedeemed,
  computePointsEarned,
  computePointsProgress,
  computeRewardDiscount,
  type PointsLedgerEntry,
  type RewardRule,
} from './loyalty';

const config = (overrides: Partial<LoyaltyConfig> = {}): LoyaltyConfig => ({
  ...DEFAULT_LOYALTY_CONFIG,
  ...overrides,
});

describe('points ledger', () => {
  const entries: PointsLedgerEntry[] = [
    { amount: 10, type: 'ORDER_EARNED', createdAt: new Date('2026-08-01') },
    { amount: 15, type: 'ORDER_EARNED', createdAt: new Date('2026-08-05') },
    { amount: 50, type: 'REFERRAL_BONUS', createdAt: new Date('2026-08-06') },
    { amount: -100, type: 'REWARD_REDEMPTION', createdAt: new Date('2026-08-07') },
  ];

  it('derives the balance from the ledger', () => {
    expect(computeBalance(entries)).toBe(-25);
  });

  it('is zero for a new account', () => {
    expect(computeBalance([])).toBe(0);
  });

  it('counts lifetime redemptions as a positive figure', () => {
    expect(computeLifetimeRedeemed(entries)).toBe(100);
  });
});

describe('computePointsEarned', () => {
  it('awards one point per Rs. 100 by default', () => {
    expect(computePointsEarned({ subtotal: 120000, discountTotal: 0 }, config())).toBe(12);
  });

  it('rounds down partial units', () => {
    expect(computePointsEarned({ subtotal: 65000, discountTotal: 0 }, config())).toBe(6);
  });

  it('earns on the discounted amount by default', () => {
    expect(
      computePointsEarned({ subtotal: 120000, discountTotal: 40000 }, config()),
    ).toBe(8);
  });

  it('can be configured to earn on the full subtotal', () => {
    expect(
      computePointsEarned(
        { subtotal: 120000, discountTotal: 40000 },
        config({ earnBasis: 'SUBTOTAL' }),
      ),
    ).toBe(12);
  });

  it('honours a configurable rate rather than a hardcoded one', () => {
    const generous = config({ earnRateAmount: 5000, earnRatePoints: 2 });
    expect(computePointsEarned({ subtotal: 120000, discountTotal: 0 }, generous)).toBe(48);
  });

  it('applies a promotional multiplier', () => {
    expect(
      computePointsEarned({ subtotal: 120000, discountTotal: 0 }, config({ pointsMultiplier: 2 })),
    ).toBe(24);
  });

  it('awards nothing below the minimum spend', () => {
    expect(
      computePointsEarned(
        { subtotal: 20000, discountTotal: 0 },
        config({ minimumSpendForPoints: 50000 }),
      ),
    ).toBe(0);
  });

  it('awards nothing when loyalty is switched off', () => {
    expect(
      computePointsEarned({ subtotal: 120000, discountTotal: 0 }, config({ isEnabled: false })),
    ).toBe(0);
  });

  it('never awards points on a fully discounted order', () => {
    expect(computePointsEarned({ subtotal: 55000, discountTotal: 55000 }, config())).toBe(0);
  });
});

describe('checkRedeemable', () => {
  const reward: RewardRule = {
    id: 'reward_free_coffee',
    name: 'Free coffee',
    type: 'FREE_ITEM',
    pointsRequired: 200,
    discountAmount: null,
    discountPercentage: null,
    maxDiscountAmount: null,
    freeItemMenuItemIds: ['item_latte'],
    businessId: null,
    expiresAt: null,
    isActive: true,
    usageLimit: null,
    usageCount: 0,
  };

  const now = new Date('2026-09-06T09:00:00Z');

  it('allows redemption with enough points', () => {
    expect(checkRedeemable(reward, { now, balance: 250 }).ok).toBe(true);
  });

  it('refuses without enough points and says how many are missing', () => {
    const result = checkRedeemable(reward, { now, balance: 148 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INSUFFICIENT_POINTS');
    expect(result.details?.shortfall).toBe(52);
  });

  it('refuses an expired reward', () => {
    const expired = { ...reward, expiresAt: new Date('2026-01-01T00:00:00Z') };
    expect(checkRedeemable(expired, { now, balance: 1000 }).ok).toBe(false);
  });

  it('refuses a fully claimed reward', () => {
    const claimed = { ...reward, usageLimit: 100, usageCount: 100 };
    expect(checkRedeemable(claimed, { now, balance: 1000 }).ok).toBe(false);
  });

  it('refuses a reward restricted to another cafe', () => {
    const restricted = { ...reward, businessId: 'biz_other' };
    const result = checkRedeemable(restricted, {
      now,
      balance: 1000,
      businessId: 'biz_espresso_lab',
    });
    expect(result.ok).toBe(false);
  });
});

describe('computeRewardDiscount', () => {
  const lines = [
    { menuItemId: 'item_latte', unitPrice: 65000, quantity: 1, lineTotal: 65000 },
    { menuItemId: 'item_espresso', unitPrice: 35000, quantity: 2, lineTotal: 70000 },
  ];

  it('discounts a fixed amount, capped at what is owed', () => {
    const reward: RewardRule = {
      id: 'r',
      name: 'Rs. 150 off',
      type: 'FIXED_DISCOUNT',
      pointsRequired: 100,
      discountAmount: 15000,
      discountPercentage: null,
      maxDiscountAmount: null,
      freeItemMenuItemIds: [],
      businessId: null,
      expiresAt: null,
      isActive: true,
      usageLimit: null,
      usageCount: 0,
    };

    const result = computeRewardDiscount(reward, lines, 135000);
    expect(result.ok && result.value).toBe(15000);

    const capped = computeRewardDiscount(reward, lines, 10000);
    expect(capped.ok && capped.value).toBe(10000);
  });

  it('caps a percentage reward at its ceiling', () => {
    const reward: RewardRule = {
      id: 'r',
      name: '50% off up to Rs. 200',
      type: 'PERCENTAGE_DISCOUNT',
      pointsRequired: 100,
      discountAmount: null,
      discountPercentage: 50,
      maxDiscountAmount: 20000,
      freeItemMenuItemIds: [],
      businessId: null,
      expiresAt: null,
      isActive: true,
      usageLimit: null,
      usageCount: 0,
    };

    const result = computeRewardDiscount(reward, lines, 135000);
    expect(result.ok && result.value).toBe(20000);
  });

  it('takes the most expensive eligible unit off for a free-item reward', () => {
    const reward: RewardRule = {
      id: 'r',
      name: 'Free coffee',
      type: 'FREE_ITEM',
      pointsRequired: 200,
      discountAmount: null,
      discountPercentage: null,
      maxDiscountAmount: null,
      freeItemMenuItemIds: ['item_latte', 'item_espresso'],
      businessId: null,
      expiresAt: null,
      isActive: true,
      usageLimit: null,
      usageCount: 0,
    };

    const result = computeRewardDiscount(reward, lines, 135000);
    // One latte unit, not the whole two-espresso line.
    expect(result.ok && result.value).toBe(65000);
  });

  it('tells the customer to add the free item when it is missing', () => {
    const reward: RewardRule = {
      id: 'r',
      name: 'Free croissant',
      type: 'FREE_ITEM',
      pointsRequired: 200,
      discountAmount: null,
      discountPercentage: null,
      maxDiscountAmount: null,
      freeItemMenuItemIds: ['item_croissant'],
      businessId: null,
      expiresAt: null,
      isActive: true,
      usageLimit: null,
      usageCount: 0,
    };

    const result = computeRewardDiscount(reward, lines, 135000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('REDEMPTION_INVALID');
  });
});

describe('computePointsProgress', () => {
  const tiers = [
    { rewardId: 'r100', name: 'Rs. 150 reward', pointsRequired: 100 },
    { rewardId: 'r200', name: 'Free coffee', pointsRequired: 200 },
    { rewardId: 'r300', name: 'Premium coffee', pointsRequired: 300 },
  ];

  it('reports the spec example: 248 of 300', () => {
    const progress = computePointsProgress(248, tiers);
    expect(progress.nextReward?.pointsRequired).toBe(300);
    expect(progress.pointsToNextReward).toBe(52);
  });

  it('measures progress from the tier already cleared', () => {
    const progress = computePointsProgress(250, tiers);
    // Halfway between 200 and 300, not 250/300.
    expect(progress.progressToNextReward).toBeCloseTo(0.5);
  });

  it('reports completion when every tier is unlocked', () => {
    const progress = computePointsProgress(500, tiers);
    expect(progress.nextReward).toBeNull();
    expect(progress.progressToNextReward).toBe(1);
  });

  it('handles a brand new account', () => {
    const progress = computePointsProgress(0, tiers);
    expect(progress.pointsToNextReward).toBe(100);
    expect(progress.progressToNextReward).toBe(0);
  });

  it('handles a platform with no rewards configured', () => {
    const progress = computePointsProgress(40, []);
    expect(progress.nextReward).toBeNull();
  });
});

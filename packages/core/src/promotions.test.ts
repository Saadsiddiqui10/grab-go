import { describe, expect, it } from 'vitest';
import {
  computePromotionDiscount,
  evaluatePromotion,
  normalizePromoCode,
  type PromotionContext,
  type PromotionRule,
} from './promotions';

const now = new Date('2026-09-06T09:00:00Z');

function promo(overrides: Partial<PromotionRule> = {}): PromotionRule {
  return {
    id: 'promo_welcome50',
    code: 'WELCOME50',
    type: 'FIXED_DISCOUNT',
    scope: 'PLATFORM',
    value: 5000,
    maxDiscountAmount: null,
    minimumOrderTotal: 0,
    businessId: null,
    startsAt: null,
    endsAt: null,
    isActive: true,
    usageLimit: null,
    usageCount: 0,
    perUserLimit: null,
    firstOrderOnly: false,
    ...overrides,
  };
}

function context(overrides: Partial<PromotionContext> = {}): PromotionContext {
  return {
    now,
    businessId: 'biz_espresso_lab',
    subtotal: 120000,
    userCompletedOrderCount: 0,
    userRedemptionCount: 0,
    ...overrides,
  };
}

describe('normalizePromoCode', () => {
  it('is case and whitespace insensitive', () => {
    expect(normalizePromoCode(' welcome 50 ')).toBe('WELCOME50');
  });
});

describe('computePromotionDiscount', () => {
  it('applies a flat amount', () => {
    expect(computePromotionDiscount(promo(), 120000)).toBe(5000);
  });

  it('applies a percentage', () => {
    expect(
      computePromotionDiscount(promo({ type: 'PERCENTAGE_DISCOUNT', value: 25 }), 120000),
    ).toBe(30000);
  });

  it('honours the maximum discount cap', () => {
    expect(
      computePromotionDiscount(
        promo({ type: 'PERCENTAGE_DISCOUNT', value: 50, maxDiscountAmount: 20000 }),
        120000,
      ),
    ).toBe(20000);
  });

  it('never exceeds the subtotal', () => {
    expect(computePromotionDiscount(promo({ value: 500000 }), 120000)).toBe(120000);
  });
});

describe('evaluatePromotion', () => {
  it('accepts a valid code', () => {
    const result = evaluatePromotion(promo(), context());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.discount).toBe(5000);
  });

  it('rejects an inactive code', () => {
    const result = evaluatePromotion(promo({ isActive: false }), context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROMO_INVALID');
  });

  it('rejects a code that has not started', () => {
    const result = evaluatePromotion(
      promo({ startsAt: new Date('2026-10-01T00:00:00Z') }),
      context(),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an expired code', () => {
    const result = evaluatePromotion(
      promo({ endsAt: new Date('2026-08-01T00:00:00Z') }),
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROMO_EXPIRED');
  });

  it('rejects another cafe’s promotion', () => {
    const result = evaluatePromotion(
      promo({ scope: 'BUSINESS', businessId: 'biz_other' }),
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROMO_NOT_APPLICABLE');
  });

  it('accepts a cafe promotion at that cafe', () => {
    const result = evaluatePromotion(
      promo({ scope: 'BUSINESS', businessId: 'biz_espresso_lab' }),
      context(),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects once the global usage limit is exhausted', () => {
    const result = evaluatePromotion(
      promo({ usageLimit: 500, usageCount: 500 }),
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROMO_LIMIT_REACHED');
  });

  it('rejects a second use by the same customer', () => {
    const result = evaluatePromotion(
      promo({ perUserLimit: 1 }),
      context({ userRedemptionCount: 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROMO_LIMIT_REACHED');
  });

  it('rejects a first-order promo for a returning customer', () => {
    const result = evaluatePromotion(
      promo({ firstOrderOnly: true }),
      context({ userCompletedOrderCount: 3 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROMO_NOT_APPLICABLE');
  });

  it('tells the customer how much more they need to spend', () => {
    const result = evaluatePromotion(
      promo({ minimumOrderTotal: 150000 }),
      context({ subtotal: 120000 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details?.shortfall).toBe(30000);
      expect(result.message).toContain('300');
    }
  });

  it('rejects a promotion worth nothing on this basket', () => {
    const result = evaluatePromotion(
      promo({ type: 'PERCENTAGE_DISCOUNT', value: 0 }),
      context(),
    );
    expect(result.ok).toBe(false);
  });
});

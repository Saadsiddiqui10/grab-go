import { describe, expect, it } from 'vitest';
import { DEFAULT_LOYALTY_CONFIG, ModifierSelectionType } from '@grabgo/types';
import { computeQuote, priceCartLine, type PricingMenuItem } from './pricing';

/**
 * Fixture mirrors the spec's example item:
 *   Iced Latte Rs. 650, Regular/Large (+Rs. 100),
 *   Milk: Regular / Almond (+150) / Oat (+150),
 *   Extras: Extra shot (+150), Vanilla (+100)
 */
function icedLatte(overrides: Partial<PricingMenuItem> = {}): PricingMenuItem {
  return {
    id: 'item_latte',
    businessId: 'biz_espresso_lab',
    name: 'Iced Latte',
    imageUrl: null,
    basePrice: 65000,
    isAvailable: true,
    isSoldOut: false,
    variants: [
      { id: 'var_reg', name: 'Regular', priceDelta: 0, isAvailable: true, isDefault: true },
      { id: 'var_lrg', name: 'Large', priceDelta: 10000, isAvailable: true, isDefault: false },
    ],
    modifiers: [
      {
        id: 'mod_milk',
        name: 'Milk',
        selectionType: ModifierSelectionType.SINGLE,
        isRequired: true,
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'opt_regular', name: 'Regular', priceDelta: 0, isAvailable: true },
          { id: 'opt_almond', name: 'Almond', priceDelta: 15000, isAvailable: true },
          { id: 'opt_oat', name: 'Oat', priceDelta: 15000, isAvailable: true },
        ],
      },
      {
        id: 'mod_extras',
        name: 'Extras',
        selectionType: ModifierSelectionType.MULTIPLE,
        isRequired: false,
        minSelections: 0,
        maxSelections: 2,
        options: [
          { id: 'opt_shot', name: 'Extra shot', priceDelta: 15000, isAvailable: true },
          { id: 'opt_vanilla', name: 'Vanilla', priceDelta: 10000, isAvailable: true },
        ],
      },
    ],
    ...overrides,
  };
}

const cappuccino: PricingMenuItem = {
  id: 'item_capp',
  businessId: 'biz_espresso_lab',
  name: 'Cappuccino',
  imageUrl: null,
  basePrice: 55000,
  isAvailable: true,
  isSoldOut: false,
  variants: [],
  modifiers: [],
};

describe('priceCartLine', () => {
  it('adds variant and modifier deltas to the base price', () => {
    const result = priceCartLine(icedLatte(), {
      menuItemId: 'item_latte',
      variantId: 'var_lrg',
      modifierOptionIds: ['opt_oat', 'opt_shot'],
      quantity: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 650 + 100 (large) + 150 (oat) + 150 (extra shot) = Rs. 1050
    expect(result.value.unitPrice).toBe(105000);
    expect(result.value.lineTotal).toBe(210000);
    expect(result.value.modifiers).toHaveLength(2);
  });

  it('falls back to the default variant when none is chosen', () => {
    const result = priceCartLine(icedLatte(), {
      menuItemId: 'item_latte',
      modifierOptionIds: ['opt_regular'],
      quantity: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variant?.id).toBe('var_reg');
    expect(result.value.unitPrice).toBe(65000);
  });

  it('asks for a size when there is no default', () => {
    const item = icedLatte();
    item.variants = item.variants.map((variant) => ({ ...variant, isDefault: false }));

    const result = priceCartLine(item, {
      menuItemId: 'item_latte',
      modifierOptionIds: ['opt_regular'],
      quantity: 1,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a sold-out item', () => {
    const result = priceCartLine(icedLatte({ isSoldOut: true }), {
      menuItemId: 'item_latte',
      modifierOptionIds: ['opt_regular'],
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ITEM_UNAVAILABLE');
  });

  it('rejects an option borrowed from another item', () => {
    const result = priceCartLine(icedLatte(), {
      menuItemId: 'item_latte',
      modifierOptionIds: ['opt_regular', 'opt_from_somewhere_else'],
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MODIFIER_SELECTION_INVALID');
  });

  it('enforces a required single-select modifier', () => {
    const result = priceCartLine(icedLatte(), {
      menuItemId: 'item_latte',
      modifierOptionIds: [],
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MODIFIER_SELECTION_INVALID');
  });

  it('rejects two milks on a single-select modifier', () => {
    const result = priceCartLine(icedLatte(), {
      menuItemId: 'item_latte',
      modifierOptionIds: ['opt_oat', 'opt_almond'],
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MODIFIER_SELECTION_INVALID');
  });

  it('enforces the maximum on a multi-select modifier', () => {
    const item = icedLatte();
    const extras = item.modifiers[1];
    if (extras) extras.maxSelections = 1;

    const result = priceCartLine(item, {
      menuItemId: 'item_latte',
      modifierOptionIds: ['opt_regular', 'opt_shot', 'opt_vanilla'],
      quantity: 1,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects an unavailable modifier option', () => {
    const item = icedLatte();
    const oat = item.modifiers[0]?.options[2];
    if (oat) oat.isAvailable = false;

    const result = priceCartLine(item, {
      menuItemId: 'item_latte',
      modifierOptionIds: ['opt_oat'],
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ITEM_UNAVAILABLE');
  });

  it('rejects a non-positive or absurd quantity', () => {
    const item = icedLatte();
    expect(
      priceCartLine(item, { menuItemId: 'item_latte', modifierOptionIds: ['opt_regular'], quantity: 0 }).ok,
    ).toBe(false);
    expect(
      priceCartLine(item, { menuItemId: 'item_latte', modifierOptionIds: ['opt_regular'], quantity: 999 }).ok,
    ).toBe(false);
  });
});

describe('computeQuote', () => {
  const items = new Map<string, PricingMenuItem>([
    ['item_latte', icedLatte()],
    ['item_capp', cappuccino],
  ]);

  const baseInput = {
    businessId: 'biz_espresso_lab',
    items,
    taxBasisPoints: 0,
    loyalty: DEFAULT_LOYALTY_CONFIG,
  };

  it('totals the spec example order', () => {
    const result = computeQuote({
      ...baseInput,
      lines: [
        { menuItemId: 'item_latte', modifierOptionIds: ['opt_regular'], quantity: 1 },
        { menuItemId: 'item_capp', quantity: 1 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals.subtotal).toBe(120000);
    expect(result.value.totals.total).toBe(120000);
    // Rs. 1200 at "1 point per Rs. 100" = 12 points.
    expect(result.value.totals.pointsEarnable).toBe(12);
  });

  it('applies tax on the discounted amount', () => {
    const result = computeQuote({
      ...baseInput,
      taxBasisPoints: 500,
      lines: [{ menuItemId: 'item_capp', quantity: 2 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals.subtotal).toBe(110000);
    expect(result.value.totals.tax).toBe(5500);
    expect(result.value.totals.total).toBe(115500);
  });

  it('refuses a cart mixing two cafes', () => {
    const result = computeQuote({
      ...baseInput,
      businessId: 'biz_other',
      lines: [{ menuItemId: 'item_capp', quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CART_BUSINESS_MISMATCH');
  });

  it('refuses an empty cart', () => {
    const result = computeQuote({ ...baseInput, lines: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMPTY_CART');
  });

  it('drops a sold-out line with a warning when quoting', () => {
    const soldOut = new Map(items);
    soldOut.set('item_capp', { ...cappuccino, isSoldOut: true });

    const result = computeQuote({
      ...baseInput,
      items: soldOut,
      lines: [
        { menuItemId: 'item_latte', modifierOptionIds: ['opt_regular'], quantity: 1 },
        { menuItemId: 'item_capp', quantity: 1 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toHaveLength(1);
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.totals.subtotal).toBe(65000);
  });

  it('fails the whole checkout when strict and an item is sold out', () => {
    const soldOut = new Map(items);
    soldOut.set('item_capp', { ...cappuccino, isSoldOut: true });

    const result = computeQuote({
      ...baseInput,
      items: soldOut,
      strict: true,
      lines: [
        { menuItemId: 'item_latte', modifierOptionIds: ['opt_regular'], quantity: 1 },
        { menuItemId: 'item_capp', quantity: 1 },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ITEM_UNAVAILABLE');
  });

  it('enforces the minimum order total at checkout only', () => {
    const lines = [{ menuItemId: 'item_capp', quantity: 1 }];

    expect(computeQuote({ ...baseInput, lines, minimumOrderTotal: 100000 }).ok).toBe(true);

    const strict = computeQuote({
      ...baseInput,
      lines,
      strict: true,
      minimumOrderTotal: 100000,
    });
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.code).toBe('MINIMUM_ORDER_NOT_MET');
  });

  it('stacks a promo and a reward without going below zero', () => {
    const result = computeQuote({
      ...baseInput,
      lines: [{ menuItemId: 'item_capp', quantity: 1 }],
      promotion: {
        rule: {
          id: 'promo_1',
          code: 'WELCOME50',
          type: 'FIXED_DISCOUNT',
          scope: 'PLATFORM',
          value: 40000,
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
        },
        context: {
          now: new Date(),
          businessId: 'biz_espresso_lab',
          userCompletedOrderCount: 0,
          userRedemptionCount: 0,
        },
      },
      reward: {
        id: 'reward_1',
        name: 'Rs. 300 off',
        type: 'FIXED_DISCOUNT',
        pointsRequired: 100,
        discountAmount: 30000,
        discountPercentage: null,
        maxDiscountAmount: null,
        freeItemMenuItemIds: [],
        businessId: null,
        expiresAt: null,
        isActive: true,
        usageLimit: null,
        usageCount: 0,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals.subtotal).toBe(55000);
    expect(result.value.totals.promoDiscount).toBe(40000);
    // Only Rs. 150 of merchandise is left, so the Rs. 300 reward is capped there.
    expect(result.value.totals.rewardDiscount).toBe(15000);
    expect(result.value.totals.discountTotal).toBe(55000);
    expect(result.value.totals.total).toBe(0);
  });

  it('warns instead of failing when a promo is not applicable during quoting', () => {
    const result = computeQuote({
      ...baseInput,
      lines: [{ menuItemId: 'item_capp', quantity: 1 }],
      promotion: {
        rule: {
          id: 'promo_2',
          code: 'EXPIRED',
          type: 'FIXED_DISCOUNT',
          scope: 'PLATFORM',
          value: 10000,
          maxDiscountAmount: null,
          minimumOrderTotal: 0,
          businessId: null,
          startsAt: null,
          endsAt: new Date('2020-01-01T00:00:00Z'),
          isActive: true,
          usageLimit: null,
          usageCount: 0,
          perUserLimit: null,
          firstOrderOnly: false,
        },
        context: {
          now: new Date('2026-09-06T00:00:00Z'),
          businessId: 'biz_espresso_lab',
          userCompletedOrderCount: 0,
          userRedemptionCount: 0,
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals.promoDiscount).toBe(0);
    expect(result.value.warnings.some((warning) => warning.code === 'PROMO_EXPIRED')).toBe(true);
  });
});

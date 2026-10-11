import { describe, expect, it } from 'vitest';
import { phoneSchema, passwordSchema, emailSchema, urlSchema } from './common';
import { createOrderSchema, cartLineSchema, pickupMethodSchema, vehiclePlateSchema } from './orders';
import { menuModifierSchema, openingHourSchema } from './catalog';
import { merchantRewardSchema, promotionSchema, rewardSchema } from './loyalty';
import { formatZodError } from './format';
import { initiatePaymentSchema } from './payments';

describe('phoneSchema', () => {
  it('normalises every way a Karachi number gets typed', () => {
    for (const input of [
      '03001234567',
      '0300 1234567',
      '0300-123-4567',
      '+923001234567',
      '923001234567',
      '3001234567',
    ]) {
      expect(phoneSchema.parse(input)).toBe('+923001234567');
    }
  });

  it('rejects landlines and nonsense', () => {
    expect(phoneSchema.safeParse('0211234567').success).toBe(false);
    expect(phoneSchema.safeParse('hello').success).toBe(false);
    expect(phoneSchema.safeParse('0300123').success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('lowercases and trims', () => {
    expect(emailSchema.parse('  Saad@Example.COM ')).toBe('saad@example.com');
  });
});

describe('passwordSchema', () => {
  it('requires length rather than symbol soup', () => {
    expect(passwordSchema.safeParse('P@ss1!').success).toBe(false);
    expect(passwordSchema.safeParse('flat white mornings').success).toBe(true);
  });
});

describe('cartLineSchema', () => {
  it('defaults modifiers to an empty list', () => {
    const parsed = cartLineSchema.parse({ menuItemId: 'item_latte', quantity: 1 });
    expect(parsed.modifierOptionIds).toEqual([]);
  });

  it('rejects a zero quantity', () => {
    expect(cartLineSchema.safeParse({ menuItemId: 'item_latte', quantity: 0 }).success).toBe(
      false,
    );
  });
});

describe('createOrderSchema', () => {
  const base = {
    businessId: 'biz_espresso_lab',
    lines: [{ menuItemId: 'item_latte', quantity: 1 }],
    paymentMethod: 'CARD',
    idempotencyKey: 'idem_01234567',
  };

  it('accepts an ASAP order without a pickup time', () => {
    const result = createOrderSchema.safeParse({ ...base, pickup: { mode: 'ASAP' } });
    expect(result.success).toBe(true);
  });

  it('requires a time for a scheduled pickup', () => {
    const result = createOrderSchema.safeParse({ ...base, pickup: { mode: 'SCHEDULED' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)['pickup.pickupAt']).toBeDefined();
    }
  });

  it('accepts a scheduled pickup with a timestamp', () => {
    const result = createOrderSchema.safeParse({
      ...base,
      pickup: { mode: 'SCHEDULED', pickupAt: '2026-09-06T05:30:00.000Z' },
    });
    expect(result.success).toBe(true);
  });

  it('exposes no field for prices or totals', () => {
    const result = createOrderSchema.parse({ ...base, pickup: { mode: 'ASAP' } });
    expect(result).not.toHaveProperty('total');
    expect(result).not.toHaveProperty('subtotal');
  });

  it('requires an idempotency key so a retry cannot double-charge', () => {
    const { idempotencyKey, ...withoutKey } = base;
    void idempotencyKey;
    expect(
      createOrderSchema.safeParse({ ...withoutKey, pickup: { mode: 'ASAP' } }).success,
    ).toBe(false);
  });
});

describe('menuModifierSchema', () => {
  const options = [
    { name: 'Regular', priceDelta: 0 },
    { name: 'Oat', priceDelta: 15000 },
  ];

  it('accepts a well-formed single-select group', () => {
    const result = menuModifierSchema.safeParse({
      name: 'Milk',
      selectionType: 'SINGLE',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      options,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a single-select group that allows two choices', () => {
    const result = menuModifierSchema.safeParse({
      name: 'Milk',
      selectionType: 'SINGLE',
      minSelections: 1,
      maxSelections: 2,
      options,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a maximum below the minimum', () => {
    const result = menuModifierSchema.safeParse({
      name: 'Extras',
      selectionType: 'MULTIPLE',
      minSelections: 3,
      maxSelections: 1,
      options,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a group with no options', () => {
    const result = menuModifierSchema.safeParse({
      name: 'Extras',
      selectionType: 'MULTIPLE',
      options: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('openingHourSchema', () => {
  it('accepts a normal trading day', () => {
    expect(
      openingHourSchema.safeParse({ dayOfWeek: 1, opensAt: 480, closesAt: 1380 }).success,
    ).toBe(true);
  });

  it('accepts a closed day without times', () => {
    expect(
      openingHourSchema.safeParse({
        dayOfWeek: 0,
        isClosed: true,
        opensAt: null,
        closesAt: null,
      }).success,
    ).toBe(true);
  });

  it('accepts a cafe that closes after midnight', () => {
    expect(
      openingHourSchema.safeParse({ dayOfWeek: 5, opensAt: 480, closesAt: 60 }).success,
    ).toBe(true);
  });

  it('rejects an open day missing its times', () => {
    expect(
      openingHourSchema.safeParse({ dayOfWeek: 1, opensAt: null, closesAt: null }).success,
    ).toBe(false);
  });
});

describe('promotionSchema', () => {
  const base = {
    code: 'WELCOME50',
    type: 'FIXED_DISCOUNT' as const,
    scope: 'PLATFORM' as const,
    value: 5000,
  };

  it('accepts a platform promo', () => {
    expect(promotionSchema.safeParse(base).success).toBe(true);
  });

  it('requires a cafe for a business-scoped promo', () => {
    const result = promotionSchema.safeParse({ ...base, scope: 'BUSINESS' });
    expect(result.success).toBe(false);
  });

  it('rejects a percentage above 100', () => {
    const result = promotionSchema.safeParse({
      ...base,
      type: 'PERCENTAGE_DISCOUNT',
      value: 150,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an end date before the start', () => {
    const result = promotionSchema.safeParse({
      ...base,
      startsAt: '2026-09-10T00:00:00.000Z',
      endsAt: '2026-09-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('formatZodError', () => {
  it('produces indexed paths a form can bind to', () => {
    const result = createOrderSchema.safeParse({
      businessId: 'biz_x',
      lines: [{ menuItemId: 'item_latte', quantity: -1 }],
      pickup: { mode: 'ASAP' },
      paymentMethod: 'CARD',
      idempotencyKey: 'idem_01234567',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(formatZodError(result.error))).toContain('lines[0].quantity');
    }
  });
});

describe('curbside pickup', () => {
  it('normalises the plates people actually type', () => {
    expect(vehiclePlateSchema.parse(' khi 4521 ')).toBe('KHI 4521');
    expect(vehiclePlateSchema.parse('bkr-729')).toBe('BKR-729');
    expect(vehiclePlateSchema.parse('LEA1234')).toBe('LEA1234');
  });

  it('rejects plates the runner could not match to a car', () => {
    for (const input of ['', 'K', '-ABC', 'ABC-', 'AB#12', 'A'.repeat(17)]) {
      expect(vehiclePlateSchema.safeParse(input).success).toBe(false);
    }
  });

  it('defaults to walking in, and needs a plate for the car', () => {
    expect(pickupMethodSchema.parse(undefined)).toEqual({ method: 'WALK_IN' });
    expect(pickupMethodSchema.safeParse({ method: 'CURBSIDE' }).success).toBe(false);
    expect(
      pickupMethodSchema.parse({ method: 'CURBSIDE', vehiclePlate: 'khi 1', vehicleDetails: 'White Corolla' }),
    ).toEqual({ method: 'CURBSIDE', vehiclePlate: 'KHI 1', vehicleDetails: 'White Corolla' });
  });
});

describe('cafe rewards', () => {
  it('requires a cafe on every admin-created reward', () => {
    const reward = { name: 'Rs. 150 off', pointsRequired: 100, type: 'FIXED_DISCOUNT', discountAmount: 15000 };
    expect(rewardSchema.safeParse(reward).success).toBe(false);
    expect(rewardSchema.safeParse({ ...reward, businessId: 'biz_espresso_lab' }).success).toBe(true);
  });

  it('takes the cafe from the route for merchants, and still checks the value', () => {
    expect(
      merchantRewardSchema.safeParse({ name: 'Free drink', pointsRequired: 200, type: 'FREE_ITEM' }).success,
    ).toBe(false);
    expect(
      merchantRewardSchema.safeParse({
        name: 'Free drink',
        pointsRequired: 200,
        type: 'FREE_ITEM',
        freeItemMenuItemIds: ['item_flat_white'],
      }).success,
    ).toBe(true);
  });
});

describe('urlSchema', () => {
  it('accepts web links', () => {
    expect(urlSchema.parse(' https://cdn.example.com/logo.png ')).toBe('https://cdn.example.com/logo.png');
    expect(urlSchema.safeParse('http://example.com/a.jpg').success).toBe(true);
  });

  it('refuses script and data links', () => {
    for (const value of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'ftp://example.com/x']) {
      expect(urlSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('payment return URL', () => {
  it('only returns to the app or an https page', () => {
    const base = { orderId: 'cmorder00000001', method: 'CARD' as const };
    expect(initiatePaymentSchema.safeParse({ ...base, returnUrl: 'grabgo://order-confirmed/order_1' }).success).toBe(true);
    expect(initiatePaymentSchema.safeParse({ ...base, returnUrl: 'https://grabgo.pk/paid' }).success).toBe(true);
    expect(initiatePaymentSchema.safeParse({ ...base, returnUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(initiatePaymentSchema.safeParse({ ...base, returnUrl: 'http://evil.example' }).success).toBe(false);
  });
});

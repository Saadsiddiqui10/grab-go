import {
  PromotionScope,
  PromotionType,
  type Paisa,
  type PromotionType as PromotionTypeT,
} from '@grabgo/types';
import { clampDiscount, percentOf } from './money';
import { fail, ok, type Result } from './errors';

/**
 * Promo code evaluation.
 *
 * Every rule here runs on the server against the stored promotion row. The client
 * may *display* a discount, but the number that reaches the order is the one this
 * function returns.
 */

export interface PromotionRule {
  id: string;
  code: string;
  type: PromotionTypeT;
  scope: (typeof PromotionScope)[keyof typeof PromotionScope];
  /** Paisa for FIXED_DISCOUNT, whole/decimal percent for PERCENTAGE_DISCOUNT. */
  value: number;
  /** Ceiling for percentage promos, so "50% off" cannot cost Rs. 5,000. */
  maxDiscountAmount: Paisa | null;
  minimumOrderTotal: Paisa;
  /** Null for platform-wide promos. */
  businessId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  /** Total redemptions allowed across all users. Null = unlimited. */
  usageLimit: number | null;
  usageCount: number;
  /** Redemptions allowed per user. Null = unlimited. */
  perUserLimit: number | null;
  /** Restricts the promo to a customer's very first completed order. */
  firstOrderOnly: boolean;
}

export interface PromotionContext {
  now: Date;
  businessId: string;
  subtotal: Paisa;
  /** Completed orders this customer already has. Drives `firstOrderOnly`. */
  userCompletedOrderCount: number;
  /** How many times this user has already redeemed this promo. */
  userRedemptionCount: number;
}

export interface PromotionEvaluation {
  discount: Paisa;
  code: string;
  promotionId: string;
  description: string;
}

export function describePromotion(promo: PromotionRule): string {
  if (promo.type === PromotionType.FIXED_DISCOUNT) {
    return `Rs. ${Math.round(promo.value / 100)} off`;
  }
  return `${promo.value}% off`;
}

/**
 * Validate and price a promo code.
 *
 * Order matters: eligibility failures are reported before the discount is computed
 * so the customer gets the specific reason ("expired", "minimum not met") rather
 * than a generic rejection.
 */
export function evaluatePromotion(
  promo: PromotionRule,
  context: PromotionContext,
): Result<PromotionEvaluation> {
  if (!promo.isActive) {
    return fail('PROMO_INVALID', 'This promo code is no longer available.');
  }

  if (promo.startsAt && context.now < promo.startsAt) {
    return fail('PROMO_INVALID', 'This promo code is not active yet.');
  }

  if (promo.endsAt && context.now > promo.endsAt) {
    return fail('PROMO_EXPIRED', 'This promo code has expired.');
  }

  if (promo.scope === PromotionScope.BUSINESS && promo.businessId !== context.businessId) {
    return fail('PROMO_NOT_APPLICABLE', 'This promo code is not valid at this cafe.');
  }

  if (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit) {
    return fail('PROMO_LIMIT_REACHED', 'This promo code has been fully claimed.');
  }

  if (
    promo.perUserLimit !== null &&
    context.userRedemptionCount >= promo.perUserLimit
  ) {
    return fail('PROMO_LIMIT_REACHED', 'You have already used this promo code.');
  }

  if (promo.firstOrderOnly && context.userCompletedOrderCount > 0) {
    return fail('PROMO_NOT_APPLICABLE', 'This promo code is for first orders only.');
  }

  if (context.subtotal < promo.minimumOrderTotal) {
    const shortfall = promo.minimumOrderTotal - context.subtotal;
    return fail(
      'PROMO_NOT_APPLICABLE',
      `Add Rs. ${Math.ceil(shortfall / 100)} more to use this promo code.`,
      { minimumOrderTotal: promo.minimumOrderTotal, shortfall },
    );
  }

  const discount = computePromotionDiscount(promo, context.subtotal);

  if (discount <= 0) {
    return fail('PROMO_NOT_APPLICABLE', 'This promo code does not apply to your order.');
  }

  return ok({
    discount,
    code: promo.code,
    promotionId: promo.id,
    description: describePromotion(promo),
  });
}

/** Raw discount maths, split out so it can be unit-tested without eligibility noise. */
export function computePromotionDiscount(promo: PromotionRule, subtotal: Paisa): Paisa {
  const raw =
    promo.type === PromotionType.FIXED_DISCOUNT
      ? Math.round(promo.value)
      : percentOf(subtotal, promo.value);

  const capped =
    promo.maxDiscountAmount !== null ? Math.min(raw, promo.maxDiscountAmount) : raw;

  return clampDiscount(capped, subtotal);
}

/** Codes are stored and compared uppercase, so "welcome50" matches "WELCOME50". */
export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

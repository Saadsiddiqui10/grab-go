import {
  computeQuote,
  normalizePromoCode,
  type PricingMenuItem,
  type PromotionContext,
  type PromotionRule,
  type QuoteResult,
  type RewardRule,
} from '@grabgo/core';
import type { CartLineInput, LoyaltyConfig } from '@grabgo/types';
import type { DbOrTx } from '../db';
import { expect, HttpError } from '../lib/http-error';
import { getLoyaltyConfig } from './settings.service';
import { menuItemWithOptions } from '../mappers';

/**
 * Server-authoritative pricing.
 *
 * This service loads the *current* menu, promotion and reward rows and hands them
 * to the pure engine in `@grabgo/core`. The client's cart contributes item ids and
 * quantities and nothing else — there is no code path here that reads a price from
 * a request body.
 */

export async function loadPricingItems(
  db: DbOrTx,
  businessId: string,
  menuItemIds: readonly string[],
): Promise<Map<string, PricingMenuItem>> {
  const unique = [...new Set(menuItemIds)];
  if (unique.length === 0) return new Map();

  const items = await db.menuItem.findMany({
    where: { id: { in: unique }, businessId, deletedAt: null },
    ...menuItemWithOptions,
  });

  return new Map(
    items.map((item) => [
      item.id,
      {
        id: item.id,
        businessId: item.businessId,
        name: item.name,
        imageUrl: item.imageUrl,
        basePrice: item.basePrice,
        isAvailable: item.isAvailable,
        isSoldOut: item.isSoldOut,
        variants: item.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          priceDelta: variant.priceDelta,
          isAvailable: variant.isAvailable,
          isDefault: variant.isDefault,
        })),
        modifiers: item.modifiers.map((modifier) => ({
          id: modifier.id,
          name: modifier.name,
          selectionType: modifier.selectionType,
          isRequired: modifier.isRequired,
          minSelections: modifier.minSelections,
          maxSelections: modifier.maxSelections,
          options: modifier.options.map((option) => ({
            id: option.id,
            name: option.name,
            priceDelta: option.priceDelta,
            isAvailable: option.isAvailable,
          })),
        })),
      } satisfies PricingMenuItem,
    ]),
  );
}

export interface QuoteRequest {
  businessId: string;
  userId: string | null;
  lines: readonly CartLineInput[];
  promoCode?: string | null;
  redemptionId?: string | null;
  /** Strict at checkout: any problem fails the request instead of warning. */
  strict?: boolean;
  now?: Date;
}

export interface PricedQuote extends QuoteResult {
  promotionId: string | null;
  redemptionId: string | null;
  /** Who absorbs the promo discount, carried onto the order for settlement. */
  discountFundedBy: 'PLATFORM' | 'MERCHANT';
  loyalty: LoyaltyConfig;
}

export async function priceCart(db: DbOrTx, request: QuoteRequest): Promise<PricedQuote> {
  const now = request.now ?? new Date();
  const strict = request.strict ?? false;

  const business = await db.business.findUnique({
    where: { id: request.businessId },
    select: {
      id: true,
      taxBasisPoints: true,
      minimumOrderTotal: true,
      loyaltyEnabled: true,
    },
  });

  if (!business) throw new HttpError('NOT_FOUND', 'That cafe could not be found.');

  const [items, loyalty] = await Promise.all([
    loadPricingItems(
      db,
      request.businessId,
      request.lines.map((line) => line.menuItemId),
    ),
    getLoyaltyConfig(db),
  ]);

  const promotion = request.promoCode
    ? await loadPromotion(db, request.promoCode, request, now)
    : null;

  const reward = request.redemptionId
    ? await loadRedemption(db, request.redemptionId, request.userId, request.businessId)
    : null;

  const result = expect(
    computeQuote({
      businessId: request.businessId,
      lines: request.lines,
      items,
      taxBasisPoints: business.taxBasisPoints,
      // A cafe that has opted out of loyalty must not accrue points on its orders.
      loyalty: business.loyaltyEnabled ? loyalty : { ...loyalty, isEnabled: false },
      minimumOrderTotal: business.minimumOrderTotal,
      strict,
      ...(promotion ? { promotion: promotion.input } : {}),
      ...(reward ? { reward: reward.rule } : {}),
    }),
  );

  return {
    ...result,
    promotionId: result.appliedPromotionId,
    redemptionId: result.appliedRewardId ? (reward?.redemptionId ?? null) : null,
    discountFundedBy: promotion?.fundedBy ?? 'PLATFORM',
    loyalty,
  };
}

interface LoadedPromotion {
  input: {
    rule: PromotionRule;
    context: Omit<PromotionContext, 'subtotal'>;
  };
  fundedBy: 'PLATFORM' | 'MERCHANT';
}

async function loadPromotion(
  db: DbOrTx,
  rawCode: string,
  request: QuoteRequest,
  now: Date,
): Promise<LoadedPromotion | null> {
  const code = normalizePromoCode(rawCode);
  const promotion = await db.promotion.findUnique({ where: { code } });

  if (!promotion) {
    if (request.strict) {
      throw new HttpError('PROMO_INVALID', 'That promo code does not exist.');
    }
    return null;
  }

  // Per-user history is what makes `perUserLimit` and `firstOrderOnly` enforceable.
  const [userRedemptionCount, userCompletedOrderCount] = request.userId
    ? await Promise.all([
        db.promoRedemption.count({
          where: { promotionId: promotion.id, userId: request.userId },
        }),
        db.order.count({
          where: {
            userId: request.userId,
            status: { in: ['PICKED_UP', 'COMPLETED'] },
          },
        }),
      ])
    : [0, 0];

  const rule: PromotionRule = {
    id: promotion.id,
    code: promotion.code,
    type: promotion.type,
    scope: promotion.scope,
    value: promotion.value,
    maxDiscountAmount: promotion.maxDiscountAmount,
    minimumOrderTotal: promotion.minimumOrderTotal,
    businessId: promotion.businessId,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    isActive: promotion.isActive,
    usageLimit: promotion.usageLimit,
    usageCount: promotion.usageCount,
    perUserLimit: promotion.perUserLimit,
    firstOrderOnly: promotion.firstOrderOnly,
  };

  return {
    input: {
      rule,
      context: {
        now,
        businessId: request.businessId,
        userCompletedOrderCount,
        userRedemptionCount,
      },
    },
    fundedBy: promotion.fundedBy,
  };
}

async function loadRedemption(
  db: DbOrTx,
  redemptionId: string,
  userId: string | null,
  businessId: string,
): Promise<{ rule: RewardRule; redemptionId: string } | null> {
  if (!userId) return null;

  const redemption = await db.rewardRedemption.findUnique({
    where: { id: redemptionId },
    include: { reward: true },
  });

  // A redemption belongs to exactly one person and can only be spent once.
  if (!redemption || redemption.userId !== userId) {
    throw new HttpError('REDEMPTION_INVALID', 'That reward is not available on this account.');
  }

  if (redemption.status !== 'ISSUED' && redemption.status !== 'APPLIED') {
    throw new HttpError('REDEMPTION_INVALID', 'That reward has already been used.');
  }

  if (redemption.expiresAt && redemption.expiresAt < new Date()) {
    throw new HttpError('REDEMPTION_INVALID', 'That reward has expired.');
  }

  if (redemption.reward.businessId && redemption.reward.businessId !== businessId) {
    throw new HttpError('REDEMPTION_INVALID', 'That reward cannot be used at this cafe.');
  }

  return {
    redemptionId: redemption.id,
    rule: {
      id: redemption.reward.id,
      name: redemption.reward.name,
      type: redemption.reward.type,
      pointsRequired: redemption.reward.pointsRequired,
      discountAmount: redemption.reward.discountAmount,
      discountPercentage: redemption.reward.discountPercentage,
      maxDiscountAmount: redemption.reward.maxDiscountAmount,
      freeItemMenuItemIds: redemption.reward.freeItemMenuItemIds,
      businessId: redemption.reward.businessId,
      expiresAt: redemption.reward.expiresAt,
      isActive: redemption.reward.isActive,
      usageLimit: redemption.reward.usageLimit,
      usageCount: redemption.reward.usageCount,
    },
  };
}

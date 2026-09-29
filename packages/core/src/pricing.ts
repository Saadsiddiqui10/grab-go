import {
  DEFAULT_CURRENCY,
  ModifierSelectionType,
  type CartLineInput,
  type LoyaltyConfig,
  type ModifierSelectionType as ModifierSelectionTypeT,
  type OrderTotals,
  type Paisa,
  type PricedCartLine,
  type PricedModifierOption,
  type QuoteWarning,
} from '@grabgo/types';
import { fail, ok, type Result } from './errors';
import { clamp, clampDiscount, percentageOf, sum } from './money';
import { computePointsEarned, computeRewardDiscount, type RewardRule } from './loyalty';
import { evaluatePromotion, type PromotionContext, type PromotionRule } from './promotions';

/**
 * Authoritative order pricing.
 *
 * The client sends item ids, a variant id and modifier option ids — never a price.
 * This module reads the current menu, re-derives every number, and the result is
 * what gets charged. A tampered client can change what is ordered, never what it costs.
 */

export const MAX_LINE_QUANTITY = 30;

export interface PricingVariant {
  id: string;
  name: string;
  priceDelta: Paisa;
  isAvailable: boolean;
  isDefault: boolean;
}

export interface PricingModifierOption {
  id: string;
  name: string;
  priceDelta: Paisa;
  isAvailable: boolean;
}

export interface PricingModifier {
  id: string;
  name: string;
  selectionType: ModifierSelectionTypeT;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  options: PricingModifierOption[];
}

export interface PricingMenuItem {
  id: string;
  businessId: string;
  name: string;
  imageUrl: string | null;
  basePrice: Paisa;
  isAvailable: boolean;
  isSoldOut: boolean;
  variants: PricingVariant[];
  modifiers: PricingModifier[];
}

/** Price one basket line, validating every selection against the live menu. */
export function priceCartLine(
  item: PricingMenuItem,
  line: CartLineInput,
): Result<PricedCartLine> {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return fail('VALIDATION_ERROR', 'Quantity must be at least 1.', {
      menuItemId: item.id,
    });
  }

  if (line.quantity > MAX_LINE_QUANTITY) {
    return fail(
      'VALIDATION_ERROR',
      `You can order at most ${MAX_LINE_QUANTITY} of one item.`,
      { menuItemId: item.id },
    );
  }

  if (!item.isAvailable || item.isSoldOut) {
    return fail('ITEM_UNAVAILABLE', `${item.name} is no longer available.`, {
      menuItemId: item.id,
    });
  }

  const variantResult = resolveVariant(item, line.variantId ?? null);
  if (!variantResult.ok) return variantResult;
  const variant = variantResult.value;

  const modifiersResult = resolveModifiers(item, line.modifierOptionIds ?? []);
  if (!modifiersResult.ok) return modifiersResult;
  const modifiers = modifiersResult.value;

  const unitPrice =
    item.basePrice +
    (variant?.priceDelta ?? 0) +
    sum(modifiers.map((modifier) => modifier.priceDelta));

  if (unitPrice < 0) {
    return fail('VALIDATION_ERROR', 'This combination produces an invalid price.', {
      menuItemId: item.id,
    });
  }

  return ok({
    menuItemId: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    quantity: line.quantity,
    basePrice: item.basePrice,
    variant: variant
      ? { id: variant.id, name: variant.name, priceDelta: variant.priceDelta }
      : null,
    modifiers,
    unitPrice,
    lineTotal: unitPrice * line.quantity,
    notes: line.notes?.trim() ? line.notes.trim() : null,
  });
}

function resolveVariant(
  item: PricingMenuItem,
  variantId: string | null,
): Result<PricingVariant | null> {
  if (item.variants.length === 0) {
    if (variantId) {
      return fail('VALIDATION_ERROR', `${item.name} has no size options.`, {
        menuItemId: item.id,
      });
    }
    return ok(null);
  }

  if (!variantId) {
    // An item with sizes but no explicit choice falls back to its default, which is
    // what the menu screen preselects. If the cafe never marked one, ask.
    const fallback =
      item.variants.find((variant) => variant.isDefault && variant.isAvailable) ?? null;
    if (!fallback) {
      return fail('VALIDATION_ERROR', `Choose a size for ${item.name}.`, {
        menuItemId: item.id,
      });
    }
    return ok(fallback);
  }

  const variant = item.variants.find((candidate) => candidate.id === variantId);
  if (!variant) {
    return fail('VALIDATION_ERROR', `That size is not available for ${item.name}.`, {
      menuItemId: item.id,
    });
  }
  if (!variant.isAvailable) {
    return fail('ITEM_UNAVAILABLE', `${variant.name} ${item.name} is sold out.`, {
      menuItemId: item.id,
    });
  }

  return ok(variant);
}

function resolveModifiers(
  item: PricingMenuItem,
  optionIds: readonly string[],
): Result<PricedModifierOption[]> {
  const selected = new Set(optionIds);
  const priced: PricedModifierOption[] = [];

  // Every submitted option must belong to this item. Catches both client bugs and
  // an attempt to attach a cheap item's modifier to an expensive one.
  const knownOptionIds = new Set(
    item.modifiers.flatMap((modifier) => modifier.options.map((option) => option.id)),
  );
  for (const optionId of selected) {
    if (!knownOptionIds.has(optionId)) {
      return fail(
        'MODIFIER_SELECTION_INVALID',
        `An option you chose is not available for ${item.name}.`,
        { menuItemId: item.id, optionId },
      );
    }
  }

  for (const modifier of item.modifiers) {
    const chosen = modifier.options.filter((option) => selected.has(option.id));

    for (const option of chosen) {
      if (!option.isAvailable) {
        return fail('ITEM_UNAVAILABLE', `${option.name} is currently unavailable.`, {
          menuItemId: item.id,
          optionId: option.id,
        });
      }
    }

    const max =
      modifier.selectionType === ModifierSelectionType.SINGLE
        ? 1
        : (modifier.maxSelections ?? Number.POSITIVE_INFINITY);
    const min = modifier.isRequired ? Math.max(1, modifier.minSelections) : modifier.minSelections;

    if (chosen.length < min) {
      return fail(
        'MODIFIER_SELECTION_INVALID',
        min === 1
          ? `Choose a ${modifier.name.toLowerCase()} for ${item.name}.`
          : `Choose at least ${min} ${modifier.name.toLowerCase()} options for ${item.name}.`,
        { menuItemId: item.id, modifierId: modifier.id },
      );
    }

    if (chosen.length > max) {
      return fail(
        'MODIFIER_SELECTION_INVALID',
        max === 1
          ? `Choose only one ${modifier.name.toLowerCase()} for ${item.name}.`
          : `Choose at most ${max} ${modifier.name.toLowerCase()} options for ${item.name}.`,
        { menuItemId: item.id, modifierId: modifier.id },
      );
    }

    for (const option of chosen) {
      priced.push({
        optionId: option.id,
        modifierId: modifier.id,
        modifierName: modifier.name,
        optionName: option.name,
        priceDelta: option.priceDelta,
      });
    }
  }

  return ok(priced);
}

/* ----------------------------------------------------------------- full quote */

export interface QuoteInput {
  businessId: string;
  lines: readonly CartLineInput[];
  /** Current menu rows for every referenced item, keyed by id. */
  items: ReadonlyMap<string, PricingMenuItem>;
  taxBasisPoints: number;
  loyalty: LoyaltyConfig;
  promotion?: { rule: PromotionRule; context: Omit<PromotionContext, 'subtotal'> } | null;
  reward?: RewardRule | null;
  minimumOrderTotal?: Paisa;
  /**
   * `strict` is used at checkout: any unavailable line fails the whole request.
   * Quoting a cart uses non-strict, dropping bad lines with a warning so the
   * customer sees "one item sold out" instead of a dead screen.
   */
  strict?: boolean;
}

export interface QuoteResult {
  lines: PricedCartLine[];
  totals: OrderTotals;
  warnings: QuoteWarning[];
  appliedPromoCode: string | null;
  appliedPromotionId: string | null;
  appliedRewardId: string | null;
}

/**
 * Price a whole basket.
 *
 * Discounts stack promo-first, then reward, each clamped so the running total can
 * never go below zero. Tax is charged on the discounted amount, which is the
 * behaviour merchants expect on their statement.
 */
export function computeQuote(input: QuoteInput): Result<QuoteResult> {
  const strict = input.strict ?? false;
  const warnings: QuoteWarning[] = [];
  const priced: PricedCartLine[] = [];

  if (input.lines.length === 0) {
    return fail('EMPTY_CART', 'Your cart is empty.');
  }

  for (const line of input.lines) {
    const item = input.items.get(line.menuItemId);

    if (!item) {
      if (strict) {
        return fail('ITEM_UNAVAILABLE', 'An item in your cart is no longer on the menu.', {
          menuItemId: line.menuItemId,
        });
      }
      warnings.push({
        code: 'ITEM_REMOVED',
        message: 'An item in your cart is no longer on the menu.',
        menuItemId: line.menuItemId,
      });
      continue;
    }

    if (item.businessId !== input.businessId) {
      return fail(
        'CART_BUSINESS_MISMATCH',
        'Your cart can only contain items from one cafe.',
        { menuItemId: line.menuItemId },
      );
    }

    const result = priceCartLine(item, line);
    if (!result.ok) {
      if (strict || result.code !== 'ITEM_UNAVAILABLE') {
        return result;
      }
      warnings.push({
        code: result.code,
        message: result.message,
        menuItemId: line.menuItemId,
      });
      continue;
    }

    priced.push(result.value);
  }

  if (priced.length === 0) {
    return fail('EMPTY_CART', 'Nothing in your cart is available right now.');
  }

  const subtotal = sum(priced.map((line) => line.lineTotal));

  const minimum = input.minimumOrderTotal ?? 0;
  if (strict && subtotal < minimum) {
    return fail(
      'MINIMUM_ORDER_NOT_MET',
      `Orders start at Rs. ${Math.ceil(minimum / 100)}.`,
      { minimumOrderTotal: minimum, subtotal },
    );
  }

  let promoDiscount: Paisa = 0;
  let appliedPromoCode: string | null = null;
  let appliedPromotionId: string | null = null;

  if (input.promotion) {
    const evaluation = evaluatePromotion(input.promotion.rule, {
      ...input.promotion.context,
      subtotal,
    });

    if (evaluation.ok) {
      promoDiscount = evaluation.value.discount;
      appliedPromoCode = evaluation.value.code;
      appliedPromotionId = evaluation.value.promotionId;
    } else if (strict) {
      return evaluation;
    } else {
      warnings.push({ code: evaluation.code, message: evaluation.message });
    }
  }

  let rewardDiscount: Paisa = 0;
  let appliedRewardId: string | null = null;

  if (input.reward) {
    const remaining = Math.max(0, subtotal - promoDiscount);
    const evaluation = computeRewardDiscount(input.reward, priced, remaining);

    if (evaluation.ok) {
      rewardDiscount = evaluation.value;
      appliedRewardId = input.reward.id;
    } else if (strict) {
      return evaluation;
    } else {
      warnings.push({ code: evaluation.code, message: evaluation.message });
    }
  }

  const discountTotal = clampDiscount(promoDiscount + rewardDiscount, subtotal);
  const taxableBase = subtotal - discountTotal;
  // A misconfigured tax rate should not be able to produce a negative or absurd
  // total, so the stored basis points are clamped to a sane 0-100% band.
  const tax = percentageOf(taxableBase, clamp(input.taxBasisPoints, 0, 10_000));
  const total = taxableBase + tax;

  const pointsEarnable = computePointsEarned({ subtotal, discountTotal }, input.loyalty);

  return ok({
    lines: priced,
    warnings,
    appliedPromoCode,
    appliedPromotionId,
    appliedRewardId,
    totals: {
      subtotal,
      promoDiscount,
      rewardDiscount,
      discountTotal,
      tax,
      total,
      currency: DEFAULT_CURRENCY,
      pointsEarnable,
    },
  });
}

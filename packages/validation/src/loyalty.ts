import { z } from 'zod';
import { idSchema, isoDateSchema, longTextSchema, paisaSchema, urlSchema } from './common';

/**
 * Loyalty, rewards, referrals and promotions.
 *
 * Notice there is no "add points" schema for customers. Points enter the ledger
 * only from server-side events (an order collected, a referral qualifying, an
 * admin adjustment) — there is deliberately no client-facing shape that could
 * express "give me 500 points".
 */

export const redeemRewardSchema = z.object({
  /** Scopes the redemption to one cafe when the reward is restricted. */
  businessId: idSchema.nullish(),
});

export const listPointsQuerySchema = z.object({
  cursor: z.string().max(255).nullish(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const applyReferralSchema = z.object({
  code: z.string().trim().toUpperCase().min(4).max(16),
});

/* ------------------------------------------------------- admin: configuration */

export const loyaltyConfigSchema = z.object({
  earnRateAmount: z.number().int().min(100).max(10_000_000),
  earnRatePoints: z.number().int().min(1).max(1000),
  earnBasis: z.enum(['SUBTOTAL', 'NET']),
  pointsMultiplier: z.number().min(0.1).max(10),
  expiryDays: z.number().int().min(0).max(3650),
  awardOnStatus: z.enum(['PICKED_UP', 'COMPLETED']),
  minimumSpendForPoints: paisaSchema,
  isEnabled: z.boolean(),
});

export const referralConfigSchema = z.object({
  referralsRequiredForReward: z.number().int().min(1).max(50),
  referrerPointsPerQualified: z.number().int().min(0).max(10_000),
  referrerRewardId: idSchema.nullish(),
  refereeRewardId: idSchema.nullish(),
  refereeSignupPoints: z.number().int().min(0).max(10_000),
  minimumQualifyingOrderTotal: paisaSchema,
  qualifyOnStatus: z.enum(['PICKED_UP', 'COMPLETED']),
  requireVerifiedPhone: z.boolean(),
  maxQualifiedPerMonth: z.number().int().min(1).max(1000),
  isEnabled: z.boolean(),
});

export const platformConfigSchema = z.object({
  defaultCommissionBasisPoints: z.number().int().min(0).max(5000),
  defaultTaxBasisPoints: z.number().int().min(0).max(3000),
  pickupSlotIntervalMinutes: z.number().int().min(5).max(60),
  maxScheduleAheadMinutes: z.number().int().min(15).max(7 * 24 * 60),
  pickupGraceMinutes: z.number().int().min(5).max(240),
  merchantAcceptWindowMinutes: z.number().int().min(1).max(60),
  customerCancelWindowMinutes: z.number().int().min(0).max(60),
  minimumOrderTotal: paisaSchema,
  maxPickupCodeAttempts: z.number().int().min(3).max(20),
});

/* --------------------------------------------------------- admin: reward CRUD */

export const rewardFieldsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: longTextSchema.nullish(),
  imageUrl: urlSchema.nullish(),
  pointsRequired: z.number().int().min(1).max(1_000_000),
  type: z.enum(['FIXED_DISCOUNT', 'PERCENTAGE_DISCOUNT', 'FREE_ITEM']),
  discountAmount: paisaSchema.nullish(),
  discountPercentage: z.number().min(1).max(100).nullish(),
  maxDiscountAmount: paisaSchema.nullish(),
  freeItemMenuItemIds: z.array(idSchema).max(50).default([]),
  businessId: idSchema.nullish(),
  expiresAt: isoDateSchema.nullish(),
  usageLimit: z.number().int().min(1).nullish(),
  isActive: z.boolean().default(true),
});

/**
 * Cross-field rules only make sense on a complete reward, so they live on the
 * create schema. Updates validate the fields they carry against
 * `rewardUpdateSchema` and are re-checked as a whole by the service.
 */
export const rewardSchema = rewardFieldsSchema
  .refine(
    (value) => value.type !== 'FIXED_DISCOUNT' || value.discountAmount != null,
    { message: 'Set the discount amount', path: ['discountAmount'] },
  )
  .refine(
    (value) => value.type !== 'PERCENTAGE_DISCOUNT' || value.discountPercentage != null,
    { message: 'Set the discount percentage', path: ['discountPercentage'] },
  )
  .refine(
    (value) => value.type !== 'FREE_ITEM' || value.freeItemMenuItemIds.length > 0,
    { message: 'Choose which items this reward covers', path: ['freeItemMenuItemIds'] },
  );

export const rewardUpdateSchema = rewardFieldsSchema.partial();

/* ------------------------------------------------------ admin: promotion CRUD */

export const promotionFieldsSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(32)
    .regex(/^[A-Z0-9]+$/, 'Promo codes are letters and numbers only'),
  description: longTextSchema.nullish(),
  type: z.enum(['FIXED_DISCOUNT', 'PERCENTAGE_DISCOUNT']),
  scope: z.enum(['PLATFORM', 'BUSINESS', 'REFERRAL']),
  /** Paisa for a fixed discount, percent for a percentage one. */
  value: z.number().min(1).max(10_000_000),
  maxDiscountAmount: paisaSchema.nullish(),
  minimumOrderTotal: paisaSchema.default(0),
  businessId: idSchema.nullish(),
  startsAt: isoDateSchema.nullish(),
  endsAt: isoDateSchema.nullish(),
  usageLimit: z.number().int().min(1).nullish(),
  perUserLimit: z.number().int().min(1).nullish(),
  firstOrderOnly: z.boolean().default(false),
  /** Whether the platform or the cafe absorbs the discount. */
  fundedBy: z.enum(['PLATFORM', 'MERCHANT']).default('PLATFORM'),
  isActive: z.boolean().default(true),
});

export const promotionSchema = promotionFieldsSchema
  .refine((value) => value.scope !== 'BUSINESS' || Boolean(value.businessId), {
    message: 'Choose which cafe this promotion belongs to',
    path: ['businessId'],
  })
  .refine(
    (value) => value.type !== 'PERCENTAGE_DISCOUNT' || value.value <= 100,
    { message: 'A percentage discount cannot exceed 100', path: ['value'] },
  )
  .refine(
    (value) =>
      !value.startsAt || !value.endsAt || new Date(value.startsAt) < new Date(value.endsAt),
    { message: 'The end date must be after the start date', path: ['endsAt'] },
  );

export const promotionUpdateSchema = promotionFieldsSchema.partial();

export const applyPromoSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(32),
  businessId: idSchema,
});

/* ---------------------------------------------------- admin: points adjustment */

export const adjustPointsSchema = z.object({
  userId: idSchema,
  /** Negative to deduct. Zero is rejected: an adjustment must change something. */
  amount: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, 'Enter a non-zero adjustment'),
  reason: longTextSchema,
});

export const notificationPreferencesSchema = z.object({
  push: z.record(z.string(), z.boolean()).optional(),
  email: z.record(z.string(), z.boolean()).optional(),
  sms: z.record(z.string(), z.boolean()).optional(),
});

export type LoyaltyConfigInput = z.infer<typeof loyaltyConfigSchema>;
export type ReferralConfigInput = z.infer<typeof referralConfigSchema>;
export type PlatformConfigInput = z.infer<typeof platformConfigSchema>;
export type RewardInput = z.infer<typeof rewardSchema>;
export type PromotionInput = z.infer<typeof promotionSchema>;

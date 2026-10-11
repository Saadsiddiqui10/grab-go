import { z } from 'zod';
import { idSchema, isoDateSchema, longTextSchema, shortTextSchema } from './common';

/**
 * Cart, checkout and order lifecycle contracts.
 *
 * Note what is absent from every one of these: prices, totals, points and payment
 * status. The client says *what* it wants; the server decides what it costs and
 * whether it was paid for.
 */

export const cartLineSchema = z.object({
  menuItemId: idSchema,
  variantId: idSchema.nullish(),
  modifierOptionIds: z.array(idSchema).max(20).default([]),
  quantity: z.number().int().min(1).max(30),
  notes: shortTextSchema.nullish(),
});

export const cartSchema = z.object({
  businessId: idSchema,
  lines: z.array(cartLineSchema).min(1, 'Your cart is empty').max(50),
});

export const quoteCartSchema = cartSchema.extend({
  promoCode: z.string().trim().max(32).nullish(),
  redemptionId: idSchema.nullish(),
});

export const pickupSelectionSchema = z
  .object({
    mode: z.enum(['ASAP', 'SCHEDULED']),
    /** Required for SCHEDULED; ignored for ASAP. */
    pickupAt: isoDateSchema.nullish(),
  })
  .refine((value) => value.mode === 'ASAP' || Boolean(value.pickupAt), {
    message: 'Choose a pickup time',
    path: ['pickupAt'],
  });

/**
 * A number plate as people type it: letters, digits, spaces and dashes
 * ("ABC-123", "KHI 4521"). Normalised to upper case. Pakistani plates vary by
 * province and era, so the shape is checked loosely rather than per format.
 */
export const vehiclePlateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Enter your number plate')
  .max(16, 'That plate looks too long')
  .regex(/^[A-Z0-9][A-Z0-9 -]*[A-Z0-9]$/, 'Use letters, numbers, spaces or dashes');

/** Walk in to the counter, or have the order brought to the car. */
export const pickupMethodSchema = z
  .discriminatedUnion('method', [
    z.object({ method: z.literal('WALK_IN') }),
    z.object({
      method: z.literal('CURBSIDE'),
      vehiclePlate: vehiclePlateSchema,
      /** Optional: "white Corolla", so staff spot it faster. */
      vehicleDetails: z.string().trim().max(60).nullish(),
    }),
  ])
  .default({ method: 'WALK_IN' });

export const createOrderSchema = z.object({
  businessId: idSchema,
  lines: z.array(cartLineSchema).min(1, 'Your cart is empty').max(50),
  pickup: pickupSelectionSchema,
  collection: pickupMethodSchema,
  promoCode: z.string().trim().max(32).nullish(),
  redemptionId: idSchema.nullish(),
  customerNote: shortTextSchema.nullish(),
  paymentMethod: z.enum([
    'CARD',
    'WALLET',
    'BANK_TRANSFER',
    'APPLE_PAY',
    'GOOGLE_PAY',
    'CASH_ON_PICKUP',
  ]),
  /**
   * Client-generated key that makes retries safe. A flaky connection must not be
   * able to turn one tap on "Pay" into two coffees and two charges.
   */
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const cancelOrderSchema = z.object({
  reason: shortTextSchema.optional(),
});

export const listOrdersQuerySchema = z.object({
  status: z
    .enum(['ACTIVE', 'COMPLETED', 'CANCELLED', 'ALL'])
    .default('ALL'),
  cursor: z.string().max(255).nullish(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const reorderSchema = z.object({
  orderId: idSchema,
});

/* ------------------------------------------------------------------- merchant */

export const merchantRejectOrderSchema = z.object({
  reason: z.enum([
    'ITEM_UNAVAILABLE',
    'TOO_BUSY',
    'CLOSING_SOON',
    'TECHNICAL_ISSUE',
    'OTHER',
  ]),
  note: shortTextSchema.optional(),
});

export const merchantAcceptOrderSchema = z.object({
  /** Lets the cafe correct the estimate before the customer starts waiting. */
  prepTimeMinutes: z.number().int().min(1).max(120).optional(),
});

export const merchantUpdatePrepTimeSchema = z.object({
  prepTimeMinutes: z.number().int().min(1).max(120),
});

export const verifyPickupSchema = z.object({
  code: z.string().trim().min(4).max(16),
});

/** Payload inside the QR the customer shows, verified as a signed token. */
export const verifyPickupTokenSchema = z.object({
  token: z.string().min(16).max(2048),
});

export const merchantOrdersQuerySchema = z.object({
  status: z
    .enum(['NEW', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'ALL'])
    .default('ALL'),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().max(255).nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/* ---------------------------------------------------------------------- admin */

export const adminCancelOrderSchema = z.object({
  reason: longTextSchema,
  refund: z.boolean().default(false),
});

export const adminRefundOrderSchema = z.object({
  /** Omit for a full refund. */
  amount: z.number().int().min(1).optional(),
  reason: longTextSchema,
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type QuoteCartInput = z.infer<typeof quoteCartSchema>;
export type VerifyPickupInput = z.infer<typeof verifyPickupSchema>;
export type MerchantRejectOrderInput = z.infer<typeof merchantRejectOrderSchema>;

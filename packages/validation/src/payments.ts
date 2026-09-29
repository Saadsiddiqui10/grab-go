import { z } from 'zod';
import { idSchema } from './common';

/**
 * Payment contracts.
 *
 * The client can *start* a payment and *report* what the provider's SDK told it,
 * but nothing here marks an order paid. Settlement happens when the server
 * confirms with the provider (or receives a signed webhook) — the client's word
 * is treated as a hint to go and check, never as evidence.
 */

export const paymentMethodSchema = z.enum([
  'CARD',
  'WALLET',
  'BANK_TRANSFER',
  'APPLE_PAY',
  'GOOGLE_PAY',
  'CASH_ON_PICKUP',
]);

export const initiatePaymentSchema = z.object({
  orderId: idSchema,
  method: paymentMethodSchema,
  /** Opaque token from the provider SDK (e.g. an Apple Pay payment token). */
  providerToken: z.string().max(8192).optional(),
  returnUrl: z.string().url().max(2048).optional(),
});

/**
 * Called after the provider's SDK returns. It asks the server to verify, and
 * carries no amount and no status the server would trust.
 */
export const confirmPaymentSchema = z.object({
  paymentId: idSchema,
  providerReference: z.string().trim().min(1).max(255).optional(),
});

export const webhookHeadersSchema = z.object({
  'x-signature': z.string().min(16).max(1024),
  'x-timestamp': z.string().min(4).max(32).optional(),
});

export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;

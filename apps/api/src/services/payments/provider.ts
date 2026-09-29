import type { PaymentMethod, PaymentStatus } from '@prisma/client';

/**
 * Payment provider abstraction.
 *
 * Pakistani gateways change, and the first one chosen is rarely the last. Every
 * provider-specific detail lives behind this interface, so swapping Safepay for
 * another processor is a new file implementing these five methods — not a rewrite
 * of checkout.
 *
 * The critical rule, encoded in the interface itself: `verifyPayment` is the only
 * thing that can report an order paid, and it asks the provider. There is no
 * method here that accepts a status from the client.
 */

export interface CreatePaymentInput {
  orderId: string;
  orderNumber: string;
  /** Paisa. */
  amount: number;
  currency: string;
  method: PaymentMethod;
  customerEmail?: string | null;
  customerPhone?: string | null;
  /** Opaque token from a native SDK (Apple Pay, Google Pay). */
  providerToken?: string | undefined;
  returnUrl?: string | undefined;
  idempotencyKey: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  status: PaymentStatus;
  /** Where to send the customer for 3-D Secure or a wallet handoff. */
  redirectUrl?: string;
  /** Passed to a client SDK to complete the charge on-device. */
  clientToken?: string;
  raw?: unknown;
}

export interface VerifyPaymentResult {
  status: PaymentStatus;
  /** What the provider says was actually captured, in paisa. */
  amount: number;
  providerReference?: string | undefined;
  failureReason?: string | undefined;
  raw?: unknown;
}

export interface RefundResult {
  refundedAmount: number;
  providerReference?: string | undefined;
  raw?: unknown;
}

export interface WebhookEvent {
  providerPaymentId: string;
  status: PaymentStatus;
  amount?: number;
  providerReference?: string | undefined;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  /** Whether this provider can handle a given method at all. */
  supports(method: PaymentMethod): boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /**
   * Ask the provider what really happened. Called before an order is ever marked
   * paid, and again from the webhook path.
   */
  verifyPayment(providerPaymentId: string): Promise<VerifyPaymentResult>;
  refund(providerPaymentId: string, amount: number): Promise<RefundResult>;
  /** Constant-time signature check over the raw request body. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  parseWebhook(rawBody: string): WebhookEvent;
}

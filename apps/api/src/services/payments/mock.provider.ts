import { createHmac } from 'node:crypto';
import type { PaymentMethod } from '@prisma/client';
import { constantTimeEqual, randomToken } from '../../lib/crypto';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  RefundResult,
  VerifyPaymentResult,
  WebhookEvent,
} from './provider';

/**
 * Development payment provider.
 *
 * Settles instantly so the whole order loop — checkout, points, referral
 * qualification, pickup — can be exercised without a gateway account. It is
 * refused in production by `env.ts`, so it cannot be left switched on by accident.
 *
 * It still goes through `verifyPayment` rather than short-circuiting, so the code
 * path a real provider takes is the code path that gets exercised in development.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly payments = new Map<
    string,
    { amount: number; status: 'PAID' | 'FAILED'; reference: string }
  >();

  constructor(private readonly webhookSecret: string = 'mock-webhook-secret') {}

  supports(_method: PaymentMethod): boolean {
    return true;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerPaymentId = `mock_${randomToken(12)}`;

    // A magic amount lets a developer exercise the failure path deliberately:
    // any order ending in Rs. 0.13 declines.
    const shouldFail = input.amount % 100 === 13;

    this.payments.set(providerPaymentId, {
      amount: input.amount,
      status: shouldFail ? 'FAILED' : 'PAID',
      reference: `ref_${randomToken(8)}`,
    });

    return {
      providerPaymentId,
      status: 'PENDING',
      clientToken: `mocktoken_${providerPaymentId}`,
    };
  }

  async verifyPayment(providerPaymentId: string): Promise<VerifyPaymentResult> {
    const record = this.payments.get(providerPaymentId);

    if (!record) {
      return { status: 'FAILED', amount: 0, failureReason: 'Unknown payment reference' };
    }

    if (record.status === 'FAILED') {
      return {
        status: 'FAILED',
        amount: record.amount,
        failureReason: 'Card declined (mock provider test amount)',
      };
    }

    return {
      status: 'PAID',
      amount: record.amount,
      providerReference: record.reference,
    };
  }

  async refund(providerPaymentId: string, amount: number): Promise<RefundResult> {
    const record = this.payments.get(providerPaymentId);
    if (!record) throw new Error('Unknown payment reference');

    return { refundedAmount: Math.min(amount, record.amount), providerReference: `rfnd_${randomToken(8)}` };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    return constantTimeEqual(expected, signature);
  }

  parseWebhook(rawBody: string): WebhookEvent {
    const parsed = JSON.parse(rawBody) as {
      providerPaymentId?: string;
      status?: string;
      amount?: number;
    };

    if (!parsed.providerPaymentId) {
      throw new Error('Webhook payload is missing providerPaymentId');
    }

    return {
      providerPaymentId: parsed.providerPaymentId,
      status: parsed.status === 'FAILED' ? 'FAILED' : 'PAID',
      amount: parsed.amount,
    };
  }
}

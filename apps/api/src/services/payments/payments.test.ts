import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MockPaymentProvider } from './mock.provider';

/**
 * The payment provider contract.
 *
 * These tests pin down the behaviour every provider implementation must have —
 * most importantly that `verifyPayment` is the only source of a PAID status, and
 * that webhook bodies are signature-checked before they are believed.
 */

const input = {
  orderId: 'order_1',
  orderNumber: 'G482173',
  amount: 120000,
  currency: 'PKR',
  method: 'CARD' as const,
  idempotencyKey: 'idem_1',
};

describe('MockPaymentProvider', () => {
  it('opens a payment as PENDING, never as paid', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.createPayment(input);

    // Creating a charge is not the same as capturing one.
    expect(result.status).toBe('PENDING');
    expect(result.providerPaymentId).toMatch(/^mock_/);
  });

  it('reports PAID only once asked to verify', async () => {
    const provider = new MockPaymentProvider();
    const created = await provider.createPayment(input);

    const verified = await provider.verifyPayment(created.providerPaymentId);
    expect(verified.status).toBe('PAID');
    expect(verified.amount).toBe(input.amount);
  });

  it('reports an unknown reference as failed rather than paid', async () => {
    const provider = new MockPaymentProvider();
    const verified = await provider.verifyPayment('mock_does_not_exist');
    expect(verified.status).toBe('FAILED');
  });

  it('exposes a deliberate decline path for testing', async () => {
    const provider = new MockPaymentProvider();
    // The magic amount ends in Rs. 0.13.
    const created = await provider.createPayment({ ...input, amount: 120013 });
    const verified = await provider.verifyPayment(created.providerPaymentId);

    expect(verified.status).toBe('FAILED');
    expect(verified.failureReason).toBeTruthy();
  });

  it('refunds no more than was charged', async () => {
    const provider = new MockPaymentProvider();
    const created = await provider.createPayment(input);

    const refund = await provider.refund(created.providerPaymentId, 500000);
    expect(refund.refundedAmount).toBe(input.amount);
  });

  describe('webhook signatures', () => {
    const secret = 'webhook-secret';
    const provider = new MockPaymentProvider(secret);
    const body = JSON.stringify({ providerPaymentId: 'mock_1', status: 'PAID' });
    const sign = (payload: string): string =>
      createHmac('sha256', secret).update(payload).digest('hex');

    it('accepts a correctly signed body', () => {
      expect(provider.verifyWebhookSignature(body, sign(body))).toBe(true);
    });

    it('rejects a wrong signature', () => {
      expect(provider.verifyWebhookSignature(body, sign('tampered'))).toBe(false);
    });

    it('rejects a body that was altered after signing', () => {
      const signature = sign(body);
      const tampered = JSON.stringify({ providerPaymentId: 'mock_2', status: 'PAID' });
      expect(provider.verifyWebhookSignature(tampered, signature)).toBe(false);
    });

    it('rejects a malformed signature without throwing', () => {
      expect(provider.verifyWebhookSignature(body, 'short')).toBe(false);
    });

    it('parses a valid event', () => {
      expect(provider.parseWebhook(body)).toMatchObject({
        providerPaymentId: 'mock_1',
        status: 'PAID',
      });
    });

    it('refuses a payload with no payment reference', () => {
      expect(() => provider.parseWebhook(JSON.stringify({ status: 'PAID' }))).toThrow();
    });
  });

  it('supports every method the app offers', () => {
    const provider = new MockPaymentProvider();
    for (const method of ['CARD', 'WALLET', 'APPLE_PAY', 'GOOGLE_PAY', 'CASH_ON_PICKUP'] as const) {
      expect(provider.supports(method)).toBe(true);
    }
  });
});

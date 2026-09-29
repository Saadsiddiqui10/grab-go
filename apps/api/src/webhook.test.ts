import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * The payment webhook must check signatures over the exact bytes received.
 * Real providers sign their own serialisation — whitespace, key order and all —
 * so re-serialising parsed JSON breaks every genuine signature.
 */

const findFirst = vi.hoisted(() => vi.fn(async () => null));

vi.mock('./db', () => ({ prisma: { payment: { findFirst } } }));

const { buildServer } = await import('./server');

const secret = process.env.PAYMENT_WEBHOOK_SECRET || 'mock-webhook-secret';
const sign = (body: string) => createHmac('sha256', secret).update(body).digest('hex');

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('payment webhook', () => {
  it('accepts a signature over the provider’s own formatting', async () => {
    // Pretty-printed with a non-alphabetical key order: JSON.stringify of the
    // parsed body would produce different bytes.
    const body = '{\n  "status": "PAID",\n  "providerPaymentId": "mock_42"\n}';

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { providerPaymentId: 'mock_42' } }),
    );
  });

  it('still refuses a body altered after signing', async () => {
    const body = '{"providerPaymentId":"mock_42","status":"FAILED"}';
    const tampered = body.replace('FAILED', 'PAID');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      payload: tampered,
    });

    expect(response.statusCode).toBe(403);
  });

  it('leaves JSON parsing intact for every other route', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15555550100' },
    });

    // A field-level validation error proves the body was parsed as an object.
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

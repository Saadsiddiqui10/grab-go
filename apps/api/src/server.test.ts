import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server';
import { signAccessToken } from './lib/tokens';
import { getEnv } from './env';

/**
 * HTTP boundary tests.
 *
 * Driven through `app.inject`, so no port is bound and no database is touched.
 * What is under test here is the contract every client depends on: the response
 * envelope, the error shape, and that protected routes are actually protected.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('answers without touching the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, service: 'grabgo-api' });
  });
});

describe('not found', () => {
  it('returns the standard error envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('authentication', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['GET', '/api/v1/auth/me'],
    ['GET', '/api/v1/orders'],
    ['POST', '/api/v1/orders'],
    ['POST', '/api/v1/cart/quote'],
    ['GET', '/api/v1/users/me/points'],
    ['GET', '/api/v1/users/me/referrals'],
    ['GET', '/api/v1/merchant/businesses'],
    ['GET', '/api/v1/admin/users'],
  ];

  it.each(protectedRoutes)('rejects %s %s without a token', async (method, url) => {
    const response = await app.inject({
      method: method as 'GET' | 'POST',
      url,
      payload: method === 'POST' ? {} : undefined,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('rejects a malformed bearer token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an expired token with a distinct code', async () => {
    const token = await signAccessToken(
      { sub: 'user_1', role: 'CUSTOMER' },
      getEnv().AUTH_SECRET,
      -1,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('TOKEN_EXPIRED');
  });

  it('refuses admin routes to a customer token', async () => {
    const token = await signAccessToken(
      { sub: 'user_1', role: 'CUSTOMER', businesses: [] },
      getEnv().AUTH_SECRET,
      900,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('refuses a merchant route for a cafe the token does not staff', async () => {
    const token = await signAccessToken(
      { sub: 'user_1', role: 'MERCHANT', businesses: ['biz_mine'] },
      getEnv().AUTH_SECRET,
      900,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/merchant/biz_someone_else/orders',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('validation', () => {
  it('returns field-level errors a form can bind to', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { fullName: 'A', email: 'not-an-email', password: 'short' },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.fields).toHaveProperty('email');
    expect(body.error.fields).toHaveProperty('password');
  });

  it('rejects an OTP request for a non-Pakistani mobile number', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '0211234567' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a checkout with no idempotency key', async () => {
    const token = await signAccessToken(
      { sub: 'user_1', role: 'CUSTOMER' },
      getEnv().AUTH_SECRET,
      900,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        businessId: 'biz_1',
        lines: [{ menuItemId: 'item_1', quantity: 1 }],
        pickup: { mode: 'ASAP' },
        paymentMethod: 'CARD',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields).toHaveProperty('idempotencyKey');
  });
});

describe('security headers', () => {
  it('sets the headers helmet provides', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });
});

describe('webhooks', () => {
  it('refuses an unsigned payment webhook', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments',
      payload: { providerPaymentId: 'mock_1', status: 'PAID' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a wrongly signed payment webhook', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments',
      headers: { 'x-signature': 'deadbeef'.repeat(8) },
      payload: { providerPaymentId: 'mock_1', status: 'PAID' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });
});

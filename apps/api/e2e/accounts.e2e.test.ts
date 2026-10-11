import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, call, freshIp, login, newCustomer, startApi, stopApi } from './helpers';

beforeAll(startApi);
afterAll(stopApi);

describe('accounts', () => {
  it('registers, signs in and reports who you are', async () => {
    const customer = await newCustomer();
    const me = await call('GET', '/auth/me', { token: customer.token });

    expect(me.status).toBe(200);
    expect(me.data).toMatchObject({ email: customer.email, role: 'CUSTOMER', hasPassword: true });
    await expect(login(customer.email)).resolves.toHaveProperty('token');
  });

  it('refuses a duplicate email and a weak password', async () => {
    const customer = await newCustomer();
    const duplicate = await call('POST', '/auth/register', {
      body: { fullName: 'Again', email: customer.email, password: DEMO_PASSWORD },
      ip: freshIp(),
    });
    expect(duplicate.ok).toBe(false);

    const weak = await call('POST', '/auth/register', {
      body: { fullName: 'Weak', email: `weak+${Date.now()}@example.com`, password: 'short' },
      ip: freshIp(),
    });
    expect(weak.error?.code).toBe('VALIDATION_ERROR');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await call('POST', '/auth/login', {
      body: { email: 'hina@example.com', password: 'not-the-password' },
      ip: freshIp(),
    });
    const unknown = await call('POST', '/auth/login', {
      body: { email: 'nobody-here@example.com', password: 'not-the-password' },
      ip: freshIp(),
    });
    expect(wrong.status).toBe(unknown.status);
    // Same code and wording (only the per-request id differs), so the response
    // does not reveal which emails have accounts.
    expect(wrong.error?.code).toBe(unknown.error?.code);
    expect(wrong.error?.message).toBe(unknown.error?.message);
  });

  it('locks out a flood of login attempts from one address', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await call('POST', '/auth/login', {
        body: { email: 'hina@example.com', password: 'guess' },
        ip,
      });
      statuses.push(result.status);
    }
    expect(statuses).toContain(429);
  });

  it('resets a forgotten password once, with a single-use code', async () => {
    const customer = await newCustomer();
    const request = await call('POST', '/auth/password/reset-request', {
      body: { email: customer.email },
      ip: freshIp(),
    });
    // Development servers hand the code back because email is not wired up.
    expect(request.data).toMatchObject({ sent: true });
    const token = request.data.devToken as string;
    expect(token).toBeTruthy();

    const reset = await call('POST', '/auth/password/reset', {
      body: { token, password: 'a-brand-new-passphrase' },
      ip: freshIp(),
    });
    expect(reset.ok).toBe(true);

    const replay = await call('POST', '/auth/password/reset', {
      body: { token, password: 'another-new-passphrase' },
      ip: freshIp(),
    });
    expect(replay.ok).toBe(false);

    await expect(login(customer.email, 'a-brand-new-passphrase')).resolves.toHaveProperty('token');
    await expect(login(customer.email)).rejects.toThrow();
  });

  it('answers a reset request the same way for an unknown email', async () => {
    const result = await call('POST', '/auth/password/reset-request', {
      body: { email: 'nobody-here@example.com' },
      ip: freshIp(),
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ sent: true });
  });

  it('changes the password and signs out every session', async () => {
    const customer = await newCustomer();

    const wrong = await call('POST', '/auth/password/change', {
      token: customer.token,
      body: { currentPassword: 'nope', newPassword: 'changed-passphrase-1' },
    });
    expect(wrong.error?.code).toBe('INVALID_CREDENTIALS');

    const changed = await call('POST', '/auth/password/change', {
      token: customer.token,
      body: { currentPassword: DEMO_PASSWORD, newPassword: 'changed-passphrase-1' },
    });
    expect(changed.ok).toBe(true);

    const refresh = await call('POST', '/auth/refresh', {
      body: { refreshToken: customer.refreshToken },
      ip: freshIp(),
    });
    expect(refresh.ok).toBe(false);
  });

  it('keeps protected routes protected', async () => {
    expect((await call('GET', '/auth/me')).status).toBe(401);
    expect((await call('GET', '/orders')).status).toBe(401);
    const customer = await newCustomer();
    expect((await call('GET', '/admin/users', { token: customer.token })).status).toBe(403);
  });
});

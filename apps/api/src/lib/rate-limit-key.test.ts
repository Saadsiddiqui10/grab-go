import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getEnv } from '../env';
import { rateLimitKey } from './rate-limit-key';
import { signAccessToken } from './tokens';

const env = getEnv();

function request(headers: Record<string, string>, ip = '203.0.113.7'): FastifyRequest {
  return { headers, ip } as unknown as FastifyRequest;
}

const tokenFor = (sub: string, secret = env.AUTH_SECRET, ttl = 900) =>
  signAccessToken({ sub, role: 'CUSTOMER' }, secret, ttl);

describe('rateLimitKey', () => {
  it('gives two signed-in users separate buckets', async () => {
    const a = await rateLimitKey(request({ authorization: `Bearer ${await tokenFor('user_a')}` }), env);
    const b = await rateLimitKey(request({ authorization: `Bearer ${await tokenFor('user_b')}` }), env);

    expect(a).toBe('user:user_a');
    expect(b).toBe('user:user_b');
  });

  it('does not hand out a fresh bucket for a made-up bearer value', async () => {
    const key = await rateLimitKey(request({ authorization: 'Bearer not-a-real-token' }), env);
    expect(key).toBe('ip:203.0.113.7');
  });

  it('falls back to the IP for a token signed with the wrong secret', async () => {
    const forged = await tokenFor('user_a', 'some-other-secret-that-is-long-enough-000');
    const key = await rateLimitKey(request({ authorization: `Bearer ${forged}` }), env);
    expect(key).toBe('ip:203.0.113.7');
  });

  it('ignores X-Forwarded-For and uses the address Fastify resolved', async () => {
    const key = await rateLimitKey(request({ 'x-forwarded-for': '1.2.3.4' }), env);
    expect(key).toBe('ip:203.0.113.7');
  });
});

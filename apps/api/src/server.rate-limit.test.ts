import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server';
import { loadEnv } from './env';
import { signAccessToken } from './lib/tokens';

/**
 * Rate limiting through the real plugin, with a limit small enough to hit.
 */

const LIMIT = 10;
let app: FastifyInstance | null = null;

async function serverWith(overrides: Record<string, string>): Promise<FastifyInstance> {
  app = await buildServer(loadEnv({ ...process.env, RATE_LIMIT_MAX: String(LIMIT), ...overrides }));
  await app.ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

async function burst(server: FastifyInstance, headers: () => Record<string, string>, n: number) {
  const codes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const response = await server.inject({ method: 'GET', url: '/api/v1/health', headers: headers() });
    codes.push(response.statusCode);
  }
  return codes;
}

describe('rate limiting', () => {
  it('limits each signed-in user separately', async () => {
    const server = await serverWith({});
    const env = loadEnv(process.env);
    const alice = await signAccessToken({ sub: 'alice', role: 'CUSTOMER' }, env.AUTH_SECRET, 900);
    const bob = await signAccessToken({ sub: 'bob', role: 'CUSTOMER' }, env.AUTH_SECRET, 900);

    const aliceCodes = await burst(server, () => ({ authorization: `Bearer ${alice}` }), LIMIT + 1);
    expect(aliceCodes.at(-1)).toBe(429);

    // Before the fix every JWT shared one bucket, so Bob was locked out too.
    const bobCodes = await burst(server, () => ({ authorization: `Bearer ${bob}` }), 1);
    expect(bobCodes).toEqual([200]);
  });

  it('cannot be escaped by rotating X-Forwarded-For', async () => {
    const server = await serverWith({ TRUST_PROXY_HOPS: '0' });
    let n = 0;
    const codes = await burst(server, () => ({ 'x-forwarded-for': `10.0.0.${(n += 1)}` }), LIMIT + 1);
    expect(codes.at(-1)).toBe(429);
  });

  it('cannot be escaped by rotating garbage bearer tokens', async () => {
    const server = await serverWith({});
    let n = 0;
    const codes = await burst(server, () => ({ authorization: `Bearer junk-${(n += 1)}` }), LIMIT + 1);
    expect(codes.at(-1)).toBe(429);
  });

  it('believes only the proxy hop it was told about', async () => {
    const server = await serverWith({ TRUST_PROXY_HOPS: '1' });
    let n = 0;
    // The client prepends a fake address; the proxy appends the real one last.
    const codes = await burst(
      server,
      () => ({ 'x-forwarded-for': `10.0.0.${(n += 1)}, 198.51.100.9` }),
      LIMIT + 1,
    );
    expect(codes.at(-1)).toBe(429);
  });
});

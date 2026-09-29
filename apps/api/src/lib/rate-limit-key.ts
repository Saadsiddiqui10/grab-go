import type { FastifyRequest } from 'fastify';
import type { Env } from '../env';
import { clientIp } from './auth-context';
import { verifyAccessToken } from './tokens';

/**
 * The bucket a request is rate limited in.
 *
 * Signed-in requests are limited per user, so several customers behind one
 * cafe's NAT do not throttle each other. The token is verified first: an
 * unverified bearer value is attacker-chosen, and keying on it would hand out a
 * fresh bucket for every made-up string. (Keying on a slice of the raw token is
 * worse still — every JWT starts with the same header, so all users would share
 * one bucket.) Anything that does not verify falls back to the client IP.
 */
export async function rateLimitKey(request: FastifyRequest, env: Env): Promise<string> {
  const auth = request.headers.authorization;

  if (auth?.startsWith('Bearer ')) {
    try {
      const claims = await verifyAccessToken(auth.slice(7).trim(), env.AUTH_SECRET);
      return `user:${claims.sub}`;
    } catch {
      // Expired or forged: treat as anonymous.
    }
  }

  return `ip:${clientIp(request) ?? 'unknown'}`;
}

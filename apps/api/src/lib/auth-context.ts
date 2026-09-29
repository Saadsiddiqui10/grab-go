import type { FastifyRequest } from 'fastify';
import type { UserRole } from '@grabgo/types';
import { getEnv } from '../env';
import { forbidden, unauthenticated } from './http-error';
import { verifyAccessToken } from './tokens';

/**
 * Request authentication and authorisation.
 *
 * Written as explicit helpers a handler calls, rather than as decorators applied
 * by a plugin: `const auth = await requireAuth(request)` makes it visible at the
 * top of every protected handler that it is protected, and impossible to add a
 * route that quietly forgets.
 */

export interface Principal {
  userId: string;
  role: UserRole;
  /** Business ids this user is active staff at. */
  businesses: string[];
  isAdmin: boolean;
  sessionId: string | null;
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Resolve a principal if one is present.
 *
 * Browsing is anonymous by design — the home screen, cafe pages and menus all
 * work signed out — so most read routes use this rather than `requireAuth`, and
 * simply personalise when a principal turns up.
 */
export async function optionalAuth(request: FastifyRequest): Promise<Principal | null> {
  const token = bearerToken(request);
  if (!token) return null;

  try {
    const claims = await verifyAccessToken(token, getEnv().AUTH_SECRET);
    return toPrincipal(claims);
  } catch {
    // An expired token on a public route should degrade to anonymous, not 401:
    // the customer still gets to see cafes while the client refreshes.
    return null;
  }
}

export async function requireAuth(request: FastifyRequest): Promise<Principal> {
  const token = bearerToken(request);
  if (!token) throw unauthenticated();

  const claims = await verifyAccessToken(token, getEnv().AUTH_SECRET);
  return toPrincipal(claims);
}

function toPrincipal(claims: {
  sub: string;
  role: UserRole;
  businesses?: string[];
  sid?: string;
}): Principal {
  return {
    userId: claims.sub,
    role: claims.role,
    businesses: claims.businesses ?? [],
    isAdmin: claims.role === 'ADMIN' || claims.role === 'SUPER_ADMIN',
    sessionId: claims.sid ?? null,
  };
}

export async function requireRole(
  request: FastifyRequest,
  roles: readonly UserRole[],
): Promise<Principal> {
  const principal = await requireAuth(request);
  if (!roles.includes(principal.role)) {
    throw forbidden('You do not have access to this.');
  }
  return principal;
}

export async function requireAdmin(request: FastifyRequest): Promise<Principal> {
  return requireRole(request, ['ADMIN', 'SUPER_ADMIN']);
}

/**
 * Authorise a merchant action against one cafe.
 *
 * The staff list is carried in the access token, so the common case costs no
 * database round trip. Admins pass for any business, which is what makes support
 * able to fix a cafe's order without a staff account.
 */
export async function requireStaffOf(
  request: FastifyRequest,
  businessId: string,
): Promise<Principal> {
  const principal = await requireAuth(request);

  if (principal.isAdmin) return principal;

  if (!principal.businesses.includes(businessId)) {
    throw forbidden('You do not have access to this cafe.');
  }

  return principal;
}

/**
 * The originating IP. Used for rate limiting and for hashed referral-abuse
 * signals, never stored raw.
 *
 * Deliberately `request.ip` and not the raw `X-Forwarded-For` header: Fastify
 * resolves it using `TRUST_PROXY_HOPS`, so only entries added by our own proxies
 * count. Reading the header directly would let any client pick its own IP and
 * walk straight past per-IP limits such as the OTP throttle.
 */
export function clientIp(request: FastifyRequest): string | undefined {
  return request.ip;
}

export function userAgent(request: FastifyRequest): string | undefined {
  const header = request.headers['user-agent'];
  return typeof header === 'string' ? header : undefined;
}

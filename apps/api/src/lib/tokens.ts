import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { UserRole } from '@grabgo/types';
import { HttpError } from './http-error';

/**
 * Token issuing and verification.
 *
 * Access tokens are short-lived and stateless; refresh tokens are opaque, stored
 * hashed, and rotated on every use (see `auth.service`). The access token carries
 * only what authorisation needs — id, role, and the businesses the holder staffs
 * — so a request can be authorised without a database round trip.
 */

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  role: UserRole;
  /** Business ids this user is active staff at. Empty for customers. */
  businesses?: string[];
  /** Session id, so a revoked session can be rejected if a check is added later. */
  sid?: string;
}

const ACCESS_AUDIENCE = 'grabgo:api';
const ACCESS_ISSUER = 'grabgo';

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'aud' | 'iss'>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ACCESS_ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: ACCESS_ISSUER,
      audience: ACCESS_AUDIENCE,
      algorithms: ['HS256'],
    });

    if (typeof payload.sub !== 'string') {
      throw new HttpError('UNAUTHENTICATED', 'Your session is invalid. Please sign in again.');
    }

    return payload as AccessTokenClaims;
  } catch (error) {
    if (error instanceof HttpError) throw error;

    const code = (error as { code?: string }).code;
    if (code === 'ERR_JWT_EXPIRED') {
      throw new HttpError('TOKEN_EXPIRED', 'Your session expired. Please sign in again.');
    }

    throw new HttpError('UNAUTHENTICATED', 'Your session is invalid. Please sign in again.');
  }
}

/* ------------------------------------------------------------- pickup tokens */

export interface PickupTokenClaims extends JWTPayload {
  sub: string;
  /** Order number, so a scanner can show context before hitting the API. */
  ord: string;
  /** The pickup code itself, so one scan carries proof rather than a lookup key. */
  cod: string;
}

const PICKUP_AUDIENCE = 'grabgo:pickup';

/**
 * Short-lived signed payload behind the QR the customer shows.
 *
 * Bounded lifetime matters: a screenshot of the QR shared in a group chat stops
 * working, while the customer's own app simply refreshes it.
 */
export async function signPickupToken(
  orderId: string,
  orderNumber: string,
  pickupCode: string,
  secret: string,
  ttlSeconds = 900,
): Promise<string> {
  return new SignJWT({ ord: orderNumber, cod: pickupCode })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(orderId)
    .setIssuedAt()
    .setIssuer(ACCESS_ISSUER)
    .setAudience(PICKUP_AUDIENCE)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey(secret));
}

export async function verifyPickupToken(
  token: string,
  secret: string,
): Promise<PickupTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: ACCESS_ISSUER,
      audience: PICKUP_AUDIENCE,
      algorithms: ['HS256'],
    });

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.cod !== 'string' ||
      typeof payload.ord !== 'string'
    ) {
      throw new HttpError('PICKUP_CODE_INVALID', 'That pickup code is not valid.');
    }

    return payload as PickupTokenClaims;
  } catch (error) {
    if (error instanceof HttpError) throw error;

    const code = (error as { code?: string }).code;
    if (code === 'ERR_JWT_EXPIRED') {
      throw new HttpError(
        'PICKUP_CODE_INVALID',
        'That QR code has expired. Ask the customer to refresh their order screen.',
      );
    }

    throw new HttpError('PICKUP_CODE_INVALID', 'That pickup code is not valid.');
  }
}

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getEnv } from '../env';
import { HttpError } from '../lib/http-error';

/**
 * Google and Apple identity verification.
 *
 * The client sends the provider's ID token and nothing else. The signature is
 * checked against the provider's published keys, and the issuer, audience and
 * expiry are all enforced — so a caller cannot simply post
 * `{ email: "someone@else.com" }` and be believed.
 *
 * The provider's `sub` is what identifies the account. Email is treated as a
 * display detail, because emails get reassigned and Apple hands out relay
 * addresses that change.
 */

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const APPLE_ISSUER = 'https://appleid.apple.com';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export interface VerifiedIdentity {
  provider: 'GOOGLE' | 'APPLE';
  subject: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedIdentity> {
  const env = getEnv();

  // One project usually has separate client ids for web, iOS and Android; any of
  // them is a legitimate audience for our own app.
  const audiences = [
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_ID_IOS,
    env.GOOGLE_CLIENT_ID_ANDROID,
  ].filter((value): value is string => Boolean(value));

  if (audiences.length === 0) {
    throw new HttpError('SERVICE_UNAVAILABLE', 'Google sign-in is not configured.');
  }

  try {
    const { payload } = await jwtVerify(idToken, googleKeys, {
      issuer: GOOGLE_ISSUERS,
      audience: audiences,
    });

    if (typeof payload.sub !== 'string') {
      throw new HttpError('INVALID_CREDENTIALS', 'Google sign-in failed.');
    }

    return {
      provider: 'GOOGLE',
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      emailVerified: payload.email_verified === true,
      fullName: typeof payload.name === 'string' ? payload.name : null,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError('INVALID_CREDENTIALS', 'Google sign-in could not be verified.');
  }
}

export async function verifyAppleIdToken(
  idToken: string,
  fallbackName?: string | null,
): Promise<VerifiedIdentity> {
  const env = getEnv();

  if (!env.APPLE_CLIENT_ID) {
    throw new HttpError('SERVICE_UNAVAILABLE', 'Apple sign-in is not configured.');
  }

  try {
    const { payload } = await jwtVerify(idToken, appleKeys, {
      issuer: APPLE_ISSUER,
      audience: env.APPLE_CLIENT_ID,
    });

    if (typeof payload.sub !== 'string') {
      throw new HttpError('INVALID_CREDENTIALS', 'Apple sign-in failed.');
    }

    return {
      provider: 'APPLE',
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      // Apple sends this as the string "true" rather than a boolean.
      emailVerified:
        payload.email_verified === true || payload.email_verified === 'true',
      // Apple only returns the name on the very first authorisation, so the
      // client forwards what it captured then.
      fullName: fallbackName ?? null,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError('INVALID_CREDENTIALS', 'Apple sign-in could not be verified.');
  }
}

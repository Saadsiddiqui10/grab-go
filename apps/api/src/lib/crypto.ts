import {
  createHash,
  randomBytes as nodeRandomBytes,
  randomInt,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Cryptographic primitives.
 *
 * The domain package takes entropy as an argument so it stays runtime-agnostic;
 * this is where that entropy actually comes from on the server.
 */

/** CSPRNG bytes, in the shape `@grabgo/core` expects. */
export const randomBytes = (size: number): Uint8Array => new Uint8Array(nodeRandomBytes(size));

export function randomToken(byteLength = 32): string {
  return nodeRandomBytes(byteLength).toString('base64url');
}

/**
 * Hash for *high-entropy* secrets: refresh tokens, reset tokens, OTPs.
 *
 * SHA-256 is right here and wrong for passwords. These values are long random
 * strings the server generated, so there is nothing to brute-force offline; the
 * hash exists so a database dump cannot be replayed. Passwords, which are short
 * and human-chosen, use bcrypt below.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Compare against itself so the work — and the timing — is the same either way.
    nodeTimingSafeEqual(bufferA, bufferA);
    return false;
  }
  return nodeTimingSafeEqual(bufferA, bufferB);
}

/** Cost 12: roughly 250ms on commodity hardware, and tunable as hardware improves. */
const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * Spend the same time whether or not the account exists.
 *
 * Without this, a login endpoint answers "no such user" measurably faster than
 * "wrong password", which turns it into an account-enumeration oracle.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7ZlKfmpFVBSDlxLKLBmO6uJmRLBIiIe';

export async function verifyPasswordOrDecoy(
  password: string,
  hash: string | null,
): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return verifyPassword(password, hash);
}

/** Six-digit OTP with uniform distribution. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * One-way, salted hash of an IP for abuse heuristics.
 *
 * Referral fraud checks need to know "same network as another signup", not the
 * address itself, so the raw IP never reaches storage.
 */
export function hashIp(ip: string | undefined, salt: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${salt}:${ip}`, 'utf8').digest('hex').slice(0, 32);
}

/** Short, URL-safe id for reward redemption codes. */
export function shortCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let value = '';

  while (value.length < length) {
    for (const byte of nodeRandomBytes(length * 2)) {
      if (value.length >= length) break;
      if (byte >= limit) continue;
      value += alphabet[byte % alphabet.length];
    }
  }

  return value;
}

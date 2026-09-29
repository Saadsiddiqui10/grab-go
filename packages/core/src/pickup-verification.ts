import { fail, ok, type Result } from './errors';

/**
 * Pickup verification.
 *
 * The pickup code is the only thing standing between a paid order and whoever is
 * at the counter, so it is treated as a credential:
 *
 *   - generated from injected CSPRNG bytes, never `Math.random`
 *   - drawn from an alphabet with no visually ambiguous characters, because a
 *     barista mistyping O for 0 is a support ticket
 *   - compared in constant time, so timing cannot leak a prefix
 *   - attempt-limited, so 6 characters cannot be brute-forced at the counter
 *   - single-use: consumed the moment the order moves to PICKED_UP
 *
 * Entropy is injected rather than imported so this module stays free of
 * `node:crypto` and can be bundled into the mobile app for display formatting.
 */

/** No 0/O/1/I/L: 31 symbols, ~29.8 bits at length 6. */
export const PICKUP_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PICKUP_CODE_LENGTH = 6;

export type RandomBytes = (size: number) => Uint8Array;

/**
 * Draw `length` symbols uniformly from the alphabet.
 *
 * Rejection sampling, not modulo: `byte % 31` would make the first nine symbols
 * measurably more likely, and a biased credential is a weaker credential.
 */
export function generatePickupCode(
  randomBytes: RandomBytes,
  length: number = PICKUP_CODE_LENGTH,
): string {
  const alphabet = PICKUP_CODE_ALPHABET;
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let code = '';

  while (code.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      if (code.length >= length) break;
      if (byte >= limit) continue;
      code += alphabet[byte % alphabet.length];
    }
  }

  return code;
}

/** Human-readable order reference, e.g. `G482173`. */
export function generateOrderNumber(randomBytes: RandomBytes, digits = 6): string {
  const limit = Math.floor(256 / 10) * 10;
  let value = '';

  while (value.length < digits) {
    const bytes = randomBytes(digits * 2);
    for (const byte of bytes) {
      if (value.length >= digits) break;
      if (byte >= limit) continue;
      value += String(byte % 10);
    }
  }

  return `G${value}`;
}

/**
 * Tolerate lowercase, spaces and the dash we add for display.
 *
 * No character remapping is needed: 0/O and 1/I/L are absent from the alphabet by
 * construction, so a code never contains a glyph that could be read two ways.
 */
export function normalizePickupCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Constant-time string comparison.
 *
 * Always walks the full length of the longer string so the duration does not
 * reveal where two codes first differ.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export interface PickupVerificationInput {
  /** The code stored on the order. */
  expectedCode: string;
  /** What the cafe typed or scanned. */
  submittedCode: string;
  /** Failed attempts already recorded against this order. */
  attemptCount: number;
  maxAttempts: number;
  /** Orders can only be handed over from READY. */
  isOrderReady: boolean;
  /** True once the order has already been collected. */
  isAlreadyPickedUp: boolean;
}

export interface PickupVerificationSuccess {
  verified: true;
  attemptsRemaining: number;
}

/**
 * Verify a code presented at the counter.
 *
 * The checks run in this order deliberately: an already-collected order is
 * reported as such *before* any code comparison, so a replayed code cannot be
 * distinguished from a wrong one by response timing or message.
 */
export function verifyPickupCode(
  input: PickupVerificationInput,
): Result<PickupVerificationSuccess> {
  if (input.isAlreadyPickedUp) {
    return fail('CONFLICT', 'This order has already been collected.');
  }

  if (!input.isOrderReady) {
    return fail(
      'ORDER_NOT_READY',
      'Mark the order ready before verifying the pickup code.',
    );
  }

  if (input.attemptCount >= input.maxAttempts) {
    return fail(
      'PICKUP_CODE_LOCKED',
      'Too many incorrect codes. Ask a manager to complete this order.',
      { attemptCount: input.attemptCount },
    );
  }

  const expected = normalizePickupCode(input.expectedCode);
  const submitted = normalizePickupCode(input.submittedCode);

  if (!timingSafeEqual(expected, submitted)) {
    const attemptsRemaining = Math.max(0, input.maxAttempts - input.attemptCount - 1);
    return fail(
      'PICKUP_CODE_INVALID',
      attemptsRemaining > 0
        ? `That code is not valid for this order. ${attemptsRemaining} attempt${
            attemptsRemaining === 1 ? '' : 's'
          } left.`
        : 'That code is not valid for this order.',
      { attemptsRemaining },
    );
  }

  return ok({
    verified: true,
    attemptsRemaining: input.maxAttempts - input.attemptCount,
  });
}

/** Group as `ABC-DEF` for the confirmation screen; easier to read aloud. */
export function formatPickupCodeForDisplay(code: string): string {
  if (code.length <= 4) return code;
  const middle = Math.ceil(code.length / 2);
  return `${code.slice(0, middle)}-${code.slice(middle)}`;
}

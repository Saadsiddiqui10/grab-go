import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  PICKUP_CODE_ALPHABET,
  PICKUP_CODE_LENGTH,
  formatPickupCodeForDisplay,
  generateOrderNumber,
  generatePickupCode,
  normalizePickupCode,
  timingSafeEqual,
  verifyPickupCode,
  type PickupVerificationInput,
} from './pickup-verification';

const nodeRandom = (size: number): Uint8Array => new Uint8Array(randomBytes(size));

describe('generatePickupCode', () => {
  it('produces a code of the expected length from the safe alphabet', () => {
    const code = generatePickupCode(nodeRandom);
    expect(code).toHaveLength(PICKUP_CODE_LENGTH);
    for (const character of code) {
      expect(PICKUP_CODE_ALPHABET).toContain(character);
    }
  });

  it('never emits visually ambiguous characters', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generatePickupCode(nodeRandom)).not.toMatch(/[01ILO]/);
    }
  });

  it('does not repeat itself across many draws', () => {
    const codes = new Set<string>();
    for (let index = 0; index < 2000; index += 1) codes.add(generatePickupCode(nodeRandom));
    // ~30 bits of entropy: 2000 draws should collide essentially never.
    expect(codes.size).toBeGreaterThan(1990);
  });

  it('survives a generator that returns mostly rejected bytes', () => {
    // Every byte above the rejection limit must be discarded, not folded in.
    let call = 0;
    const skewed = (size: number): Uint8Array =>
      Uint8Array.from({ length: size }, () => (call++ % 8 === 0 ? 5 : 255));

    const code = generatePickupCode(skewed, 4);
    expect(code).toHaveLength(4);
  });
});

describe('generateOrderNumber', () => {
  it('is human readable and prefixed', () => {
    const number = generateOrderNumber(nodeRandom);
    expect(number).toMatch(/^G\d{6}$/);
  });
});

describe('normalizePickupCode', () => {
  it('accepts lowercase, spacing and the display dash', () => {
    expect(normalizePickupCode(' g2h-4kx ')).toBe('G2H4KX');
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('G2H4KX', 'G2H4KX')).toBe(true);
  });

  it('rejects different strings', () => {
    expect(timingSafeEqual('G2H4KX', 'G2H4KY')).toBe(false);
  });

  it('rejects a prefix', () => {
    expect(timingSafeEqual('G2H4KX', 'G2H4K')).toBe(false);
  });
});

describe('verifyPickupCode', () => {
  const base: PickupVerificationInput = {
    expectedCode: 'G2H4KX',
    submittedCode: 'G2H4KX',
    attemptCount: 0,
    maxAttempts: 5,
    isOrderReady: true,
    isAlreadyPickedUp: false,
  };

  it('accepts the right code on a ready order', () => {
    expect(verifyPickupCode(base).ok).toBe(true);
  });

  it('accepts a sloppily typed code', () => {
    expect(verifyPickupCode({ ...base, submittedCode: ' g2h4kx ' }).ok).toBe(true);
  });

  it('rejects the wrong code and counts down the attempts', () => {
    const result = verifyPickupCode({ ...base, submittedCode: 'AAAAAA' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PICKUP_CODE_INVALID');
    expect(result.details?.attemptsRemaining).toBe(4);
  });

  it('locks out a brute-force attempt', () => {
    const result = verifyPickupCode({ ...base, submittedCode: 'AAAAAA', attemptCount: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_LOCKED');
  });

  it('refuses to hand over an order that is not ready', () => {
    const result = verifyPickupCode({ ...base, isOrderReady: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ORDER_NOT_READY');
  });

  it('refuses to reuse a completed order', () => {
    const result = verifyPickupCode({ ...base, isAlreadyPickedUp: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONFLICT');
  });

  it('reports an already-collected order before comparing codes', () => {
    // A replayed valid code and a guessed wrong code must be indistinguishable.
    const replayed = verifyPickupCode({ ...base, isAlreadyPickedUp: true });
    const guessed = verifyPickupCode({
      ...base,
      isAlreadyPickedUp: true,
      submittedCode: 'ZZZZZZ',
    });
    expect(replayed.ok).toBe(false);
    expect(guessed.ok).toBe(false);
    if (!replayed.ok && !guessed.ok) expect(replayed.code).toBe(guessed.code);
  });
});

describe('formatPickupCodeForDisplay', () => {
  it('groups the code for reading aloud', () => {
    expect(formatPickupCodeForDisplay('G2H4KX')).toBe('G2H-4KX');
  });

  it('leaves short codes alone', () => {
    expect(formatPickupCodeForDisplay('2841')).toBe('2841');
  });
});

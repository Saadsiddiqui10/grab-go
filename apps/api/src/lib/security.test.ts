import { describe, expect, it } from 'vitest';
import { DomainError } from '@grabgo/core';
import {
  constantTimeEqual,
  generateOtpCode,
  hashIp,
  hashPassword,
  hashToken,
  randomToken,
  shortCode,
  verifyPassword,
  verifyPasswordOrDecoy,
} from './crypto';
import {
  signAccessToken,
  signPickupToken,
  verifyAccessToken,
  verifyPickupToken,
} from './tokens';
import { HttpError, toHttpError, expect as expectResult } from './http-error';
import { decodeCursor, encodeCursor, paginate } from './validate';

const SECRET = 'test-secret-0123456789abcdefghijklmnopqrs';
const OTHER_SECRET = 'other-secret-0123456789abcdefghijklmnopq';

describe('token hashing', () => {
  it('is deterministic and hides the input', () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it('produces different digests for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('constantTimeEqual', () => {
  it('matches identical strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  });

  it('rejects different strings of equal length', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
  });

  it('rejects strings of different lengths without throwing', () => {
    expect(constantTimeEqual('abc', 'abcdef')).toBe(false);
  });
});

describe('passwords', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('flat white mornings');
    expect(await verifyPassword('flat white mornings', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('flat white mornings');
    expect(await verifyPassword('flat white evenings', hash)).toBe(false);
  });

  it('produces a different hash each time (salted)', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('returns false for a missing hash without leaking that fact quickly', async () => {
    // The decoy comparison is what stops login timing revealing which emails exist.
    const started = Date.now();
    expect(await verifyPasswordOrDecoy('anything', null)).toBe(false);
    expect(Date.now() - started).toBeGreaterThan(5);
  });

  it('does not throw on a malformed stored hash', async () => {
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false);
  });
});

describe('generateOtpCode', () => {
  it('is always six digits', () => {
    for (let index = 0; index < 500; index += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashIp', () => {
  it('is stable for the same address and salt', () => {
    expect(hashIp('1.2.3.4', 'salt')).toBe(hashIp('1.2.3.4', 'salt'));
  });

  it('never contains the raw address', () => {
    expect(hashIp('1.2.3.4', 'salt')).not.toContain('1.2.3.4');
  });

  it('returns null when there is no address', () => {
    expect(hashIp(undefined, 'salt')).toBeNull();
  });
});

describe('shortCode', () => {
  it('avoids ambiguous characters', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(shortCode()).not.toMatch(/[01ILO]/);
    }
  });
});

describe('access tokens', () => {
  it('round-trips claims', async () => {
    const token = await signAccessToken(
      { sub: 'user_1', role: 'CUSTOMER', businesses: [] },
      SECRET,
      900,
    );
    const claims = await verifyAccessToken(token, SECRET);

    expect(claims.sub).toBe('user_1');
    expect(claims.role).toBe('CUSTOMER');
  });

  it('carries the staff business list for merchant authorisation', async () => {
    const token = await signAccessToken(
      { sub: 'user_2', role: 'MERCHANT', businesses: ['biz_1', 'biz_2'] },
      SECRET,
      900,
    );
    const claims = await verifyAccessToken(token, SECRET);
    expect(claims.businesses).toEqual(['biz_1', 'biz_2']);
  });

  it('rejects a token signed with another key', async () => {
    const token = await signAccessToken({ sub: 'u', role: 'CUSTOMER' }, OTHER_SECRET, 900);
    await expect(verifyAccessToken(token, SECRET)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a tampered token', async () => {
    const token = await signAccessToken({ sub: 'u', role: 'CUSTOMER' }, SECRET, 900);
    const [header, , signature] = token.split('.');
    const forged = `${header}.${Buffer.from(
      JSON.stringify({ sub: 'someone-else', role: 'ADMIN' }),
    ).toString('base64url')}.${signature}`;

    await expect(verifyAccessToken(forged, SECRET)).rejects.toBeInstanceOf(HttpError);
  });

  it('reports an expired token distinctly, so the client knows to refresh', async () => {
    const token = await signAccessToken({ sub: 'u', role: 'CUSTOMER' }, SECRET, -1);
    await expect(verifyAccessToken(token, SECRET)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('rejects garbage', async () => {
    await expect(verifyAccessToken('not-a-token', SECRET)).rejects.toBeInstanceOf(HttpError);
  });
});

describe('pickup tokens', () => {
  it('round-trips the order and its code', async () => {
    const token = await signPickupToken('order_1', 'G482173', 'G2H4KX', SECRET, 900);
    const claims = await verifyPickupToken(token, SECRET);

    expect(claims.sub).toBe('order_1');
    expect(claims.ord).toBe('G482173');
    expect(claims.cod).toBe('G2H4KX');
  });

  it('cannot be verified with the session key', async () => {
    // The two secrets are separate precisely so a leaked QR key cannot mint sessions.
    const token = await signPickupToken('order_1', 'G482173', 'G2H4KX', SECRET, 900);
    await expect(verifyPickupToken(token, OTHER_SECRET)).rejects.toMatchObject({
      code: 'PICKUP_CODE_INVALID',
    });
  });

  it('expires, so a shared screenshot stops working', async () => {
    const token = await signPickupToken('order_1', 'G482173', 'G2H4KX', SECRET, -1);
    await expect(verifyPickupToken(token, SECRET)).rejects.toMatchObject({
      code: 'PICKUP_CODE_INVALID',
    });
  });

  it('will not accept an access token in its place', async () => {
    const access = await signAccessToken({ sub: 'u', role: 'CUSTOMER' }, SECRET, 900);
    await expect(verifyPickupToken(access, SECRET)).rejects.toBeInstanceOf(HttpError);
  });
});

describe('toHttpError', () => {
  it('passes an HttpError through unchanged', () => {
    const error = new HttpError('NOT_FOUND', 'nope');
    expect(toHttpError(error)).toBe(error);
  });

  it('maps a domain error onto its HTTP status', () => {
    const error = toHttpError(new DomainError('BUSINESS_CLOSED', 'closed'));
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('BUSINESS_CLOSED');
  });

  it('maps a Prisma unique violation to a conflict', () => {
    const prismaError = Object.assign(new Error('unique'), { code: 'P2002' });
    expect(toHttpError(prismaError).statusCode).toBe(409);
  });

  it('maps a Prisma missing-record error to a 404', () => {
    const prismaError = Object.assign(new Error('missing'), { code: 'P2025' });
    expect(toHttpError(prismaError).statusCode).toBe(404);
  });

  it('hides an unexpected error behind a generic 500', () => {
    const error = toHttpError(new Error('connection string: postgres://user:hunter2@db'));
    expect(error.statusCode).toBe(500);
    expect(error.message).not.toContain('hunter2');
  });

  it('marks 5xx as unexpected and 4xx as expected', () => {
    expect(toHttpError(new Error('boom')).expected).toBe(false);
    expect(new HttpError('NOT_FOUND', 'nope').expected).toBe(true);
  });
});

describe('HttpError.toBody', () => {
  it('produces the standard error envelope', () => {
    const body = new HttpError('ITEM_UNAVAILABLE', 'Sold out', {
      details: { menuItemId: 'item_1' },
    }).toBody('req-1');

    expect(body).toEqual({
      ok: false,
      error: {
        code: 'ITEM_UNAVAILABLE',
        message: 'Sold out',
        details: { menuItemId: 'item_1' },
        requestId: 'req-1',
      },
    });
  });
});

describe('expect (Result unwrapping)', () => {
  it('returns the value on success', () => {
    expect(expectResult({ ok: true, value: 42 })).toBe(42);
  });

  it('throws the HTTP equivalent on failure', () => {
    try {
      expectResult({ ok: false, code: 'BUSINESS_AT_CAPACITY', message: 'busy' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).code).toBe('BUSINESS_AT_CAPACITY');
    }
  });
});

describe('cursors', () => {
  it('round-trips', () => {
    expect(decodeCursor(encodeCursor({ id: 'abc' }))?.id).toBe('abc');
  });

  it('treats a malformed cursor as the start of the list', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it('detects another page without a second count query', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ id: `id_${index}` }));

    const page = paginate(rows, 5);
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();

    const last = paginate(rows.slice(0, 3), 5);
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
  });
});

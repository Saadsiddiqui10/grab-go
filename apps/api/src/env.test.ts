import { describe, expect, it } from 'vitest';
import { corsOrigins, loadEnv } from './env';

/**
 * The environment loader is a safety device: it exists so a misconfigured
 * deployment fails at boot rather than at a customer's checkout.
 */

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  AUTH_SECRET: 'a'.repeat(40),
  PICKUP_TOKEN_SECRET: 'b'.repeat(40),
};

describe('loadEnv', () => {
  it('applies sensible development defaults', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.PAYMENT_PROVIDER).toBe('mock');
  });

  it('refuses a missing database url', () => {
    const { DATABASE_URL, ...withoutDb } = base;
    void DATABASE_URL;
    expect(() => loadEnv(withoutDb as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('refuses a short signing secret', () => {
    expect(() =>
      loadEnv({ ...base, AUTH_SECRET: 'too-short' } as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_SECRET/);
  });

  it('coerces numeric variables from strings', () => {
    const env = loadEnv({ ...base, PORT: '8080' } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(8080);
  });

  describe('production guards', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://grabandgo.pk',
      PAYMENT_PROVIDER: 'safepay',
      SMS_PROVIDER: 'twilio',
    };

    it('accepts a properly configured production environment', () => {
      expect(() => loadEnv(production as NodeJS.ProcessEnv)).not.toThrow();
    });

    it('refuses wildcard CORS in production', () => {
      expect(() =>
        loadEnv({ ...production, CORS_ORIGINS: '*' } as NodeJS.ProcessEnv),
      ).toThrow(/CORS_ORIGINS/);
    });

    it('refuses the mock payment provider in production', () => {
      expect(() =>
        loadEnv({ ...production, PAYMENT_PROVIDER: 'mock' } as NodeJS.ProcessEnv),
      ).toThrow(/mock payment provider/);
    });

    it('refuses the mock SMS provider in production', () => {
      expect(() =>
        loadEnv({ ...production, SMS_PROVIDER: 'mock' } as NodeJS.ProcessEnv),
      ).toThrow(/SMS provider/);
    });

    it('refuses a hardcoded development OTP in production', () => {
      expect(() =>
        loadEnv({ ...production, OTP_DEV_CODE: '000000' } as NodeJS.ProcessEnv),
      ).toThrow(/OTP_DEV_CODE/);
    });

    it('allows the development OTP outside production', () => {
      const env = loadEnv({ ...base, OTP_DEV_CODE: '123456' } as NodeJS.ProcessEnv);
      expect(env.OTP_DEV_CODE).toBe('123456');
    });
  });
});

describe('corsOrigins', () => {
  it('returns true for the wildcard', () => {
    expect(corsOrigins(loadEnv(base as NodeJS.ProcessEnv))).toBe(true);
  });

  it('splits an explicit list', () => {
    const env = loadEnv({
      ...base,
      CORS_ORIGINS: 'https://a.pk, https://b.pk',
    } as NodeJS.ProcessEnv);
    expect(corsOrigins(env)).toEqual(['https://a.pk', 'https://b.pk']);
  });
});

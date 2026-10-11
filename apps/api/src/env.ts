import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Parsed once, at boot, and validated hard: a server that starts with a missing
 * JWT secret and only discovers it when the first user logs in is worse than one
 * that refuses to start. Nothing else in the codebase reads `process.env`.
 */

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().url('DATABASE_URL must be a valid Postgres connection string'),

    /** Signs short-lived access tokens. */
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    /**
     * Signs pickup QR payloads. Separate from AUTH_SECRET so a leaked QR key
     * cannot be used to mint session tokens.
     */
    PICKUP_TOKEN_SECRET: z
      .string()
      .min(32, 'PICKUP_TOKEN_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(60),

    /** Comma-separated list; `*` allows any origin (development only). */
    CORS_ORIGINS: z.string().default('*'),

    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    WEB_PUBLIC_URL: z.string().url().default('http://localhost:5173'),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_ID_IOS: z.string().optional(),
    GOOGLE_CLIENT_ID_ANDROID: z.string().optional(),
    APPLE_CLIENT_ID: z.string().optional(),

    /** `mock` writes OTPs to the log; swap for a real gateway in production. */
    SMS_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    PAYMENT_PROVIDER: z.enum(['mock', 'safepay']).default('mock'),
    PAYMENT_PROVIDER_KEY: z.string().optional(),
    PAYMENT_PROVIDER_SECRET: z.string().optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),

    /** Expo push works without a key for most projects; set for stricter sending. */
    EXPO_ACCESS_TOKEN: z.string().optional(),
    PUSH_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    /**
     * Encrypts cafes' POS signing secrets at rest. Required in production for
     * a cafe to connect a POS; development derives one from AUTH_SECRET.
     */
    POS_SECRET_KEY: z.string().min(32, 'POS_SECRET_KEY must be at least 32 characters').optional(),

    STORAGE_BUCKET: z.string().optional(),
    STORAGE_PUBLIC_URL: z.string().url().optional(),

    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
    /** Development convenience: a fixed OTP so a simulator can log in. */
    OTP_DEV_CODE: z.string().regex(/^\d{6}$/).optional(),

    /**
     * How many reverse proxies (load balancer, CDN) sit in front of the API.
     * Only that many `X-Forwarded-For` hops are believed when working out the
     * client IP; anything further left was written by the client and is ignored.
     * 0 means the API is reached directly and the header is ignored entirely.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),

    /** Background sweep interval for expiring unaccepted orders, in seconds. */
    JOB_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(60),
    JOBS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    if (value.CORS_ORIGINS.trim() === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'Set explicit CORS origins in production',
      });
    }

    if (value.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message: 'The mock payment provider must not be used in production',
      });
    }

    if (value.SMS_PROVIDER === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_PROVIDER'],
        message: 'Configure a real SMS provider in production',
      });
    }

    if (value.OTP_DEV_CODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_DEV_CODE'],
        message: 'OTP_DEV_CODE must not be set in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Treat an empty variable as absent.
 *
 * `.env` files are full of placeholder lines like `STORAGE_PUBLIC_URL=`, and an
 * empty string should mean "not configured" rather than failing the URL check on
 * an optional setting.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    cleaned[key] = value;
  }

  return cleaned;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(withoutBlanks(source));

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return parsed.data;
}

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test helper: reset the memoised value between cases. */
export function resetEnvCache(): void {
  cached = null;
}

export function corsOrigins(env: Env): string[] | true {
  const raw = env.CORS_ORIGINS.trim();
  if (raw === '*') return true;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const isProduction = (env: Env): boolean => env.NODE_ENV === 'production';
export const isTest = (env: Env): boolean => env.NODE_ENV === 'test';

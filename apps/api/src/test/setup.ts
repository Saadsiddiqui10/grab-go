/**
 * Test environment.
 *
 * These tests exercise the HTTP boundary, token handling and payment
 * verification, none of which touch Postgres. DATABASE_URL is set because the
 * Prisma client is constructed at import time; no connection is opened.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://grabgo:grabgo@localhost:5432/grabgo_test?schema=public';
process.env.AUTH_SECRET ??= 'test-auth-secret-0123456789abcdefghijklmno';
process.env.PICKUP_TOKEN_SECRET ??= 'test-pickup-secret-0123456789abcdefghijkl';
process.env.LOG_LEVEL ??= 'silent';
process.env.JOBS_ENABLED ??= 'false';
process.env.PAYMENT_PROVIDER ??= 'mock';
process.env.SMS_PROVIDER ??= 'mock';

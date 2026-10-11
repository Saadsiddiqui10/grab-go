/**
 * Environment for the e2e suite, set before any API module loads (the Prisma
 * client and `getEnv()` read it once, at import).
 *
 * NODE_ENV is `development` on purpose: it is what makes the API hand back
 * password-reset codes and accept a POS receiver on localhost, both of which
 * the suite exercises. Jobs are off; tests run the sweeps they need directly.
 */
import { e2eDatabaseUrl } from './global-setup';

process.env.DATABASE_URL = e2eDatabaseUrl();
process.env.NODE_ENV = 'development';
process.env.AUTH_SECRET ??= 'e2e-auth-secret-0123456789abcdefghijklmnop';
process.env.PICKUP_TOKEN_SECRET ??= 'e2e-pickup-secret-0123456789abcdefghijklm';
process.env.LOG_LEVEL = 'silent';
process.env.JOBS_ENABLED = 'false';
process.env.PUSH_ENABLED = 'false';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.SMS_PROVIDER = 'mock';

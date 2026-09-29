import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { API_ERROR_STATUS } from '@grabgo/types';
import { corsOrigins, getEnv, isProduction, type Env } from './env';
import { HttpError, toHttpError } from './lib/http-error';
import { rateLimitKey } from './lib/rate-limit-key';
import { registerRoutes } from './routes';

/**
 * Fastify application assembly.
 *
 * Split from `index.ts` so tests can build an app instance and drive it with
 * `app.inject(...)` without opening a port.
 */
export async function buildServer(env: Env = getEnv()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
      // Auth headers, OTPs and pickup codes must never reach the log.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.newPassword',
          'req.body.currentPassword',
          'req.body.code',
          'req.body.idToken',
          'req.body.refreshToken',
          'req.body.token',
        ],
        remove: true,
      },
    },
    // Believe exactly as many X-Forwarded-For hops as we have proxies. `true`
    // would trust the left-most entry, which the client writes itself.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    bodyLimit: 1_048_576,
  });

  await app.register(helmet, {
    // The API serves JSON to native clients and two SPAs; CSP belongs on the
    // documents those are served from, not here.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: corsOrigins(env),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'X-Signature'],
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => rateLimitKey(request, env),
    // The plugin throws whatever this returns, so it must be an error the
    // handler below recognises — a plain object would surface as a 500.
    errorResponseBuilder: () =>
      new HttpError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'),
  });

  /**
   * One error handler for the whole surface.
   *
   * Expected failures (validation, a closed cafe, a wrong pickup code) are logged
   * at debug and returned verbatim. Anything unexpected is logged in full and
   * returned as a generic 500 — internal messages and stack traces are not the
   * customer's business.
   */
  app.setErrorHandler((error, request, reply) => {
    const httpError = toHttpError(error);

    if (httpError.expected) {
      request.log.debug(
        { code: httpError.code, path: request.url },
        'request rejected',
      );
    } else {
      request.log.error({ err: error, path: request.url }, 'unhandled error');
    }

    const body = httpError.toBody(request.id);

    if (!isProduction(env) && !httpError.expected && error instanceof Error) {
      body.error.details = { ...body.error.details, cause: error.message };
    }

    return reply.code(httpError.statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const error = new HttpError('NOT_FOUND', `No route for ${request.method} ${request.url}`);
    return reply.code(API_ERROR_STATUS.NOT_FOUND).send(error.toBody(request.id));
  });

  await app.register(registerRoutes, { prefix: '/api/v1' });

  return app;
}

import type { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { success } from '../lib/http-error';
import { handleWebhookEvent } from '../services/payments';
import { registerAdminRoutes } from './admin.routes';
import { registerAuthRoutes } from './auth.routes';
import { registerCatalogRoutes } from './catalog.routes';
import { registerMerchantRoutes } from './merchant.routes';
import { registerOrderRoutes } from './orders.routes';
import { registerUserRoutes } from './users.routes';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Liveness and readiness.
   *
   * `/health` answers without touching the database so a load balancer can tell
   * "process is up" from "process is up but Postgres is gone"; `/ready` is the
   * one that actually checks.
   */
  app.get('/health', async () => ({ ok: true, service: 'grabgo-api', uptime: process.uptime() }));

  app.get('/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, database: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, database: 'down' });
    }
  });

  /**
   * Payment provider webhook.
   *
   * Signature-verified against the raw body, then re-verified with the provider
   * before anything is marked paid. Always answers 200 once the signature checks
   * out — a provider that gets a 500 will retry for hours.
   */
  await app.register(async (webhooks) => {
    // Signatures are computed over the exact bytes the provider sent, so this
    // scope keeps the body as a string. Parsing and re-serialising the JSON
    // would change whitespace and key order and no real signature would match.
    webhooks.removeAllContentTypeParsers();
    webhooks.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });

    webhooks.post('/webhooks/payments', async (request, reply) => {
      const signature = request.headers['x-signature'];

      if (typeof signature !== 'string') {
        return reply.code(400).send({ ok: false, error: 'Missing signature' });
      }

      const rawBody = typeof request.body === 'string' ? request.body : '';

      await handleWebhookEvent(rawBody, signature);
      return reply.send(success({ received: true }));
    });
  });

  await registerAuthRoutes(app);
  await registerCatalogRoutes(app);
  await registerOrderRoutes(app);
  await registerUserRoutes(app);
  await registerMerchantRoutes(app);
  await registerAdminRoutes(app);
}

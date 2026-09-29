import { getEnv } from './env';
import { prisma } from './db';
import { buildServer } from './server';
import { createRealtimeServer, closeRealtime } from './realtime';
import { startJobs, stopJobs } from './jobs';

/**
 * Process entry point.
 *
 * Boot order matters: environment first (so a misconfiguration fails before
 * anything binds a port), then HTTP, then the realtime server attached to the
 * same listener, then background jobs.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildServer(env);

  await app.listen({ port: env.PORT, host: env.HOST });

  createRealtimeServer(app.server);
  startJobs();

  app.log.info(
    { port: env.PORT, env: env.NODE_ENV },
    'Grab & Go API ready — order ahead, skip the line',
  );

  // Drain in the right order on shutdown: stop taking work, finish in-flight
  // requests, close sockets, then release the database.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    stopJobs();

    try {
      await closeRealtime();
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Failed to start the Grab & Go API:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

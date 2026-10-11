import type { OrderStatus, PosProvider, Prisma } from '@prisma/client';
import { prisma, type DbOrTx } from '../../db';
import { HttpError, notFound } from '../../lib/http-error';
import type { OrderWithRelations } from '../../mappers';
import { assertSafeEndpoint, UnsafeEndpointError } from './endpoint';
import { decryptPosSecret, encryptPosSecret, generatePosSecret } from './secrets';
import type { PosAdapter, PosDeliveryResult } from './types';
import { webhookAdapter } from './webhook-adapter';

/**
 * Sending Grab & Go orders to a café's point-of-sale system.
 *
 * Transactional outbox: every order event for a café with a live connection
 * writes a `PosSyncJob` in the same transaction as the order change, so the
 * two cannot disagree. Delivery happens outside the transaction — straight
 * after the commit for speed, and from the maintenance sweep for anything that
 * failed — with exponential backoff, until it succeeds, the receiver rejects
 * it outright, or the attempts run out. Failed deliveries stay visible to the
 * café, which can retry them once its POS is fixed.
 *
 * The order board in Grab & Go stays the source of truth. A POS that is down
 * never blocks taking, accepting or handing over an order.
 */

const ADAPTERS: Record<Exclude<PosProvider, 'NONE'>, PosAdapter> = {
  WEBHOOK: webhookAdapter,
};

/** Delay before attempt n+1, after n failures: 30s, 2m, 10m, 30m, 2h, 6h. */
const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200, 21600];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
const CLAIM_SECONDS = 60;

export function eventForStatus(status: OrderStatus): string {
  return status === 'PENDING' ? 'order.created' : `order.${status.toLowerCase()}`;
}

export function nextAttemptDelaySeconds(failedAttempts: number): number | null {
  return BACKOFF_SECONDS[failedAttempts - 1] ?? null;
}

/**
 * The payload, versioned. Deliberately excludes the pickup code (a credential
 * the customer shows at the counter) and anything identifying the customer
 * beyond what the café needs to hand the order over.
 */
export function buildOrderPayload(order: OrderWithRelations, event: string): Prisma.InputJsonObject {
  return {
    version: 1,
    event,
    occurredAt: new Date().toISOString(),
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      source: order.source,
      status: order.status,
      businessId: order.businessId,
      pickup: {
        mode: order.pickupMode,
        at: order.pickupAt.toISOString(),
        estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
        method: order.pickupMethod,
        vehiclePlate: order.vehiclePlate,
        vehicleDetails: order.vehicleDetails,
      },
      customerNote: order.customerNote,
      items: order.items.map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        name: item.name,
        variant: item.variantName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        notes: item.notes,
        modifiers: item.modifiers.map((modifier) => ({
          group: modifier.modifierName,
          option: modifier.optionName,
          priceDelta: modifier.priceDelta,
        })),
      })),
      totals: {
        currency: order.currency,
        subtotal: order.subtotal,
        discount: order.discountTotal,
        tax: order.tax,
        total: order.total,
      },
      payment: order.payment
        ? { method: order.payment.method, status: order.payment.status }
        : null,
      cancellationReason: order.cancellationReason,
    },
  };
}

/**
 * Queue an order event for the café's POS, inside the caller's transaction.
 * A no-op for cafés without a live connection. Idempotent per order and event.
 */
export async function enqueueOrderEvent(
  tx: DbOrTx,
  order: OrderWithRelations,
  /** Defaults to the event for the order's status; `order.paid` is the other. */
  eventOverride?: string,
): Promise<void> {
  const connection = await tx.posConnection.findUnique({
    where: { businessId: order.businessId },
    select: { isEnabled: true, provider: true },
  });
  if (!connection?.isEnabled || connection.provider === 'NONE') return;

  const event = eventOverride ?? eventForStatus(order.status);
  await tx.posSyncJob.createMany({
    data: [
      {
        businessId: order.businessId,
        orderId: order.id,
        event,
        eventKey: `${order.id}:${event}`,
        payload: buildOrderPayload(order, event),
      },
    ],
    skipDuplicates: true,
  });
}

/* ---------------------------------------------------------------- delivery */

async function loadDeliveryTarget(
  businessId: string,
): Promise<{ adapter: PosAdapter; endpointUrl: string; secret: string } | { error: string }> {
  const connection = await prisma.posConnection.findUnique({ where: { businessId } });
  if (!connection?.isEnabled || connection.provider === 'NONE') {
    return { error: 'The POS connection is switched off.' };
  }
  if (!connection.endpointUrl || !connection.secretEncrypted) {
    return { error: 'The POS connection is missing its endpoint or secret.' };
  }
  try {
    await assertSafeEndpoint(connection.endpointUrl);
    return {
      adapter: ADAPTERS[connection.provider],
      endpointUrl: connection.endpointUrl,
      secret: decryptPosSecret(connection.secretEncrypted, businessId),
    };
  } catch (error) {
    return {
      error:
        error instanceof UnsafeEndpointError || error instanceof HttpError
          ? error.message
          : 'The POS secret could not be read. Generate a new one.',
    };
  }
}

async function recordConnectionOutcome(businessId: string, result: PosDeliveryResult, now: Date): Promise<void> {
  await prisma.posConnection.updateMany({
    where: { businessId },
    data: result.ok
      ? { lastSuccessAt: now, lastError: null }
      : { lastFailureAt: now, lastError: result.error },
  });
}

/**
 * Attempt one job. Claims it first, so two API instances (or the sweep and a
 * post-commit kick) never send the same job at the same time.
 */
export async function attemptJob(jobId: string, now = new Date()): Promise<boolean> {
  const claimed = await prisma.posSyncJob.updateMany({
    where: {
      id: jobId,
      status: 'PENDING',
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil: new Date(now.getTime() + CLAIM_SECONDS * 1000) },
  });
  if (claimed.count === 0) return false;

  const job = await prisma.posSyncJob.findUniqueOrThrow({ where: { id: jobId } });
  const target = await loadDeliveryTarget(job.businessId);

  const result: PosDeliveryResult =
    'error' in target
      ? { ok: false, retryable: false, error: target.error }
      : await target.adapter.deliver({
          deliveryId: job.id,
          event: job.event,
          payload: job.payload,
          endpointUrl: target.endpointUrl,
          secret: target.secret,
        });

  const attempts = job.attempts + 1;
  const delay = result.ok ? null : result.retryable ? nextAttemptDelaySeconds(attempts) : null;

  await prisma.posSyncJob.update({
    where: { id: job.id },
    data: result.ok
      ? {
          status: 'SUCCEEDED',
          attempts,
          succeededAt: now,
          lockedUntil: null,
          lastError: null,
          lastStatusCode: result.statusCode ?? null,
        }
      : {
          status: delay === null ? 'FAILED' : 'PENDING',
          attempts,
          nextAttemptAt: new Date(now.getTime() + (delay ?? 0) * 1000),
          lockedUntil: null,
          lastError: result.error,
          lastStatusCode: result.statusCode ?? null,
        },
  });

  if (!('error' in target)) await recordConnectionOutcome(job.businessId, result, now);
  return result.ok;
}

/** Send whatever is queued for one order, straight after its transaction. */
export async function flushOrderJobs(orderId: string): Promise<void> {
  try {
    const jobs = await prisma.posSyncJob.findMany({
      where: { orderId, status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    // In order: a POS should see "created" before "accepted".
    for (const job of jobs) await attemptJob(job.id);
  } catch (error) {
    // The sweep will pick it up; never surface a POS problem to the customer.
    console.warn('[pos] immediate delivery failed', orderId, error);
  }
}

/** The maintenance sweep: everything due, oldest first. */
export async function processDuePosJobs(now = new Date(), limit = 50): Promise<number> {
  const due = await prisma.posSyncJob.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let delivered = 0;
  for (const job of due) {
    if (await attemptJob(job.id, now)) delivered += 1;
  }
  return delivered;
}

/* ------------------------------------------------------- café management */

export interface PosStatusView {
  provider: PosProvider;
  isEnabled: boolean;
  endpointUrl: string | null;
  hasSecret: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  pendingCount: number;
  failedCount: number;
  recentProblems: Array<{
    id: string;
    orderId: string;
    orderNumber: string;
    event: string;
    status: 'PENDING' | 'FAILED';
    attempts: number;
    lastError: string | null;
    lastStatusCode: number | null;
    nextAttemptAt: string | null;
    createdAt: string;
  }>;
}

export async function getPosStatus(businessId: string): Promise<PosStatusView> {
  const [connection, pendingCount, failedCount, problems] = await Promise.all([
    prisma.posConnection.findUnique({ where: { businessId } }),
    prisma.posSyncJob.count({ where: { businessId, status: 'PENDING' } }),
    prisma.posSyncJob.count({ where: { businessId, status: 'FAILED' } }),
    prisma.posSyncJob.findMany({
      where: { businessId, status: { in: ['PENDING', 'FAILED'] }, attempts: { gt: 0 } },
      include: { order: { select: { orderNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  return {
    provider: connection?.provider ?? 'NONE',
    isEnabled: connection?.isEnabled ?? false,
    endpointUrl: connection?.endpointUrl ?? null,
    hasSecret: Boolean(connection?.secretEncrypted),
    lastSuccessAt: connection?.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: connection?.lastFailureAt?.toISOString() ?? null,
    lastError: connection?.lastError ?? null,
    pendingCount,
    failedCount,
    recentProblems: problems.map((job) => ({
      id: job.id,
      orderId: job.orderId,
      orderNumber: job.order.orderNumber,
      event: job.event,
      status: job.status === 'FAILED' ? 'FAILED' : 'PENDING',
      attempts: job.attempts,
      lastError: job.lastError,
      lastStatusCode: job.lastStatusCode,
      nextAttemptAt: job.status === 'PENDING' ? job.nextAttemptAt.toISOString() : null,
      createdAt: job.createdAt.toISOString(),
    })),
  };
}

/**
 * Save the connection. Returns the signing secret only when one was created,
 * which is the one time the café sees it.
 */
export async function configurePos(
  businessId: string,
  input: { provider: PosProvider; endpointUrl?: string | null; isEnabled: boolean },
): Promise<{ secret: string | null }> {
  if (input.provider === 'NONE') {
    await prisma.posConnection.upsert({
      where: { businessId },
      create: { businessId, provider: 'NONE', isEnabled: false },
      update: { provider: 'NONE', isEnabled: false },
    });
    return { secret: null };
  }

  if (!input.endpointUrl) {
    throw new HttpError('VALIDATION_ERROR', 'Enter the endpoint your POS receives orders on.');
  }
  try {
    await assertSafeEndpoint(input.endpointUrl);
  } catch (error) {
    throw new HttpError('VALIDATION_ERROR', (error as Error).message);
  }

  const existing = await prisma.posConnection.findUnique({ where: { businessId } });
  const secret = existing?.secretEncrypted ? null : generatePosSecret();

  await prisma.posConnection.upsert({
    where: { businessId },
    create: {
      businessId,
      provider: input.provider,
      endpointUrl: input.endpointUrl.trim(),
      isEnabled: input.isEnabled,
      secretEncrypted: secret ? encryptPosSecret(secret, businessId) : null,
    },
    update: {
      provider: input.provider,
      endpointUrl: input.endpointUrl.trim(),
      isEnabled: input.isEnabled,
      ...(secret ? { secretEncrypted: encryptPosSecret(secret, businessId) } : {}),
    },
  });

  return { secret };
}

export async function rotatePosSecret(businessId: string): Promise<{ secret: string }> {
  const connection = await prisma.posConnection.findUnique({ where: { businessId } });
  if (!connection || connection.provider === 'NONE') throw notFound('That POS connection');
  const secret = generatePosSecret();
  await prisma.posConnection.update({
    where: { businessId },
    data: { secretEncrypted: encryptPosSecret(secret, businessId) },
  });
  return { secret };
}

/** Send a signed `ping` now and report what happened, without queueing it. */
export async function testPosConnection(businessId: string): Promise<{ ok: boolean; message: string }> {
  const connection = await prisma.posConnection.findUnique({ where: { businessId } });
  if (!connection || connection.provider === 'NONE' || !connection.endpointUrl || !connection.secretEncrypted) {
    throw new HttpError('VALIDATION_ERROR', 'Save a POS endpoint first.');
  }

  let result: PosDeliveryResult;
  try {
    await assertSafeEndpoint(connection.endpointUrl);
    result = await ADAPTERS[connection.provider].deliver({
      deliveryId: `ping_${Date.now()}`,
      event: 'ping',
      payload: { version: 1, event: 'ping', occurredAt: new Date().toISOString(), businessId },
      endpointUrl: connection.endpointUrl,
      secret: decryptPosSecret(connection.secretEncrypted, businessId),
    });
  } catch (error) {
    result = { ok: false, retryable: false, error: (error as Error).message };
  }

  await recordConnectionOutcome(businessId, result, new Date());
  return result.ok
    ? { ok: true, message: `Your endpoint answered ${result.statusCode ?? 'OK'}.` }
    : { ok: false, message: result.error };
}

/** Put failed (or all stuck) deliveries back in the queue and try them now. */
export async function retryPosJobs(businessId: string, jobId?: string): Promise<{ retried: number }> {
  const now = new Date();
  const jobs = await prisma.posSyncJob.findMany({
    where: { businessId, status: { in: ['FAILED', 'PENDING'] }, ...(jobId ? { id: jobId } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: { id: true },
  });
  if (jobId && jobs.length === 0) throw notFound('That delivery');

  await prisma.posSyncJob.updateMany({
    where: { id: { in: jobs.map((job) => job.id) } },
    // A manual retry gets a fresh run of attempts.
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: now, lockedUntil: null },
  });

  for (const job of jobs) await attemptJob(job.id, now);
  return { retried: jobs.length };
}

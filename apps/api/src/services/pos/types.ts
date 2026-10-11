import type { PosProvider } from '@prisma/client';

/**
 * The seam every POS integration plugs into.
 *
 * An adapter only knows how to hand one event to one system and say whether it
 * worked and whether trying again could help. Queueing, retries, backoff and
 * bookkeeping live in the outbox (`pos.service.ts`), so a new vendor is one
 * file implementing `deliver`.
 */

export interface PosDelivery {
  /** Stable for the event; receivers deduplicate on it. */
  deliveryId: string;
  event: string;
  payload: unknown;
  endpointUrl: string;
  secret: string;
}

export type PosDeliveryResult =
  | { ok: true; statusCode?: number }
  | { ok: false; retryable: boolean; statusCode?: number; error: string };

export interface PosAdapter {
  provider: Exclude<PosProvider, 'NONE'>;
  deliver(delivery: PosDelivery): Promise<PosDeliveryResult>;
}

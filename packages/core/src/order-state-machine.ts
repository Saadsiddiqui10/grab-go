import {
  ActorType,
  CANCELLED_ORDER_STATUSES,
  OrderStatus,
  TERMINAL_ORDER_STATUSES,
  type OrderRejectionReason,
} from '@grabgo/types';
import { fail, ok, type Result } from './errors';

/**
 * The authoritative order state machine.
 *
 * Every status change in the system goes through `checkTransition`. The API never
 * writes `order.status` directly, which is what makes "COMPLETED -> PREPARING"
 * unrepresentable rather than merely discouraged.
 *
 * The happy path is:
 *   PENDING -> ACCEPTED -> PREPARING -> READY -> PICKED_UP -> COMPLETED
 *
 * ACCEPTED -> READY is also permitted: a barista pulling a single espresso should
 * not have to tap "preparing" and "ready" a second apart. It is forward-only, so
 * it cannot be used to skip verification or resurrect a finished order.
 */

export interface TransitionRule {
  to: OrderStatus;
  /** Actors permitted to request this transition. */
  actors: readonly ActorType[];
  /** Cafe-side cancellations must say why (surfaced to the customer). */
  requiresReason?: boolean;
  /** PICKED_UP is only reachable once the pickup code has been verified. */
  requiresPickupVerification?: boolean;
  /** The customer may only self-cancel inside the configured window. */
  respectsCustomerCancelWindow?: boolean;
}

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly TransitionRule[]>> =
  Object.freeze({
    [OrderStatus.PENDING]: [
      { to: OrderStatus.ACCEPTED, actors: [ActorType.MERCHANT, ActorType.ADMIN] },
      {
        to: OrderStatus.CANCELLED_BY_CUSTOMER,
        actors: [ActorType.CUSTOMER, ActorType.ADMIN],
      },
      {
        to: OrderStatus.CANCELLED_BY_CAFE,
        actors: [ActorType.MERCHANT, ActorType.ADMIN],
        requiresReason: true,
      },
      { to: OrderStatus.CANCELLED_BY_ADMIN, actors: [ActorType.ADMIN] },
      { to: OrderStatus.EXPIRED, actors: [ActorType.SYSTEM] },
    ],
    [OrderStatus.ACCEPTED]: [
      { to: OrderStatus.PREPARING, actors: [ActorType.MERCHANT, ActorType.ADMIN] },
      { to: OrderStatus.READY, actors: [ActorType.MERCHANT, ActorType.ADMIN] },
      {
        to: OrderStatus.CANCELLED_BY_CUSTOMER,
        actors: [ActorType.CUSTOMER, ActorType.ADMIN],
        respectsCustomerCancelWindow: true,
      },
      {
        to: OrderStatus.CANCELLED_BY_CAFE,
        actors: [ActorType.MERCHANT, ActorType.ADMIN],
        requiresReason: true,
      },
      { to: OrderStatus.CANCELLED_BY_ADMIN, actors: [ActorType.ADMIN] },
    ],
    [OrderStatus.PREPARING]: [
      { to: OrderStatus.READY, actors: [ActorType.MERCHANT, ActorType.ADMIN] },
      {
        to: OrderStatus.CANCELLED_BY_CAFE,
        actors: [ActorType.MERCHANT, ActorType.ADMIN],
        requiresReason: true,
      },
      { to: OrderStatus.CANCELLED_BY_ADMIN, actors: [ActorType.ADMIN] },
    ],
    [OrderStatus.READY]: [
      {
        to: OrderStatus.PICKED_UP,
        actors: [ActorType.MERCHANT, ActorType.ADMIN],
        requiresPickupVerification: true,
      },
      {
        to: OrderStatus.CANCELLED_BY_CAFE,
        actors: [ActorType.MERCHANT, ActorType.ADMIN],
        requiresReason: true,
      },
      { to: OrderStatus.CANCELLED_BY_ADMIN, actors: [ActorType.ADMIN] },
      { to: OrderStatus.EXPIRED, actors: [ActorType.SYSTEM] },
    ],
    [OrderStatus.PICKED_UP]: [
      {
        to: OrderStatus.COMPLETED,
        actors: [ActorType.SYSTEM, ActorType.MERCHANT, ActorType.ADMIN],
      },
    ],
    [OrderStatus.COMPLETED]: [],
    [OrderStatus.CANCELLED_BY_CUSTOMER]: [],
    [OrderStatus.CANCELLED_BY_CAFE]: [],
    [OrderStatus.CANCELLED_BY_ADMIN]: [],
    [OrderStatus.EXPIRED]: [],
  });

export interface TransitionContext {
  actor: ActorType;
  now?: Date;
  /** Required for cafe-initiated cancellations. */
  reason?: OrderRejectionReason | null;
  /** True once a pickup code or QR token has been verified for this order. */
  pickupVerified?: boolean;
  /** When the cafe accepted, used to evaluate the customer cancel window. */
  acceptedAt?: Date | null;
  /** Minutes after acceptance during which a customer may still self-cancel. */
  customerCancelWindowMinutes?: number;
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function isCancelledStatus(status: OrderStatus): boolean {
  return CANCELLED_ORDER_STATUSES.includes(status);
}

export function isActiveStatus(status: OrderStatus): boolean {
  return !isTerminalStatus(status) && status !== OrderStatus.PICKED_UP;
}

/** Transitions `actor` could request right now. Drives merchant/admin action buttons. */
export function allowedTransitions(from: OrderStatus, actor: ActorType): OrderStatus[] {
  return (ORDER_TRANSITIONS[from] ?? [])
    .filter((rule) => rule.actors.includes(actor))
    .map((rule) => rule.to);
}

/**
 * The single guard every status write must pass.
 *
 * Returns a `Result` rather than throwing: an invalid transition is usually a
 * stale client (two baristas tapping "Ready" at once), not an exceptional event.
 */
export function checkTransition(
  from: OrderStatus,
  to: OrderStatus,
  context: TransitionContext,
): Result<TransitionRule> {
  if (from === to) {
    return fail(
      'INVALID_STATE_TRANSITION',
      `Order is already ${from}.`,
      { from, to },
    );
  }

  const rule = (ORDER_TRANSITIONS[from] ?? []).find((candidate) => candidate.to === to);

  if (!rule) {
    const message = isTerminalStatus(from)
      ? `This order is already ${from.toLowerCase().replace(/_/g, ' ')} and cannot change.`
      : `An order cannot move from ${from} to ${to}.`;
    return fail('INVALID_STATE_TRANSITION', message, { from, to });
  }

  if (!rule.actors.includes(context.actor)) {
    return fail(
      'FORBIDDEN',
      `A ${context.actor.toLowerCase()} cannot move an order from ${from} to ${to}.`,
      { from, to, actor: context.actor },
    );
  }

  if (rule.requiresReason && !context.reason) {
    return fail('VALIDATION_ERROR', 'A reason is required to cancel this order.', {
      from,
      to,
    });
  }

  if (rule.requiresPickupVerification && context.pickupVerified !== true) {
    return fail(
      'PICKUP_CODE_INVALID',
      'The pickup code must be verified before completing this order.',
      { from, to },
    );
  }

  if (rule.respectsCustomerCancelWindow && context.actor === ActorType.CUSTOMER) {
    const windowMinutes = context.customerCancelWindowMinutes ?? 0;
    const acceptedAt = context.acceptedAt ?? null;
    const now = context.now ?? new Date();

    if (!acceptedAt) {
      return fail(
        'ORDER_NOT_CANCELLABLE',
        'This order can no longer be cancelled. Please contact the cafe.',
        { from, to },
      );
    }

    const elapsedMinutes = (now.getTime() - acceptedAt.getTime()) / 60_000;
    if (elapsedMinutes > windowMinutes) {
      return fail(
        'ORDER_NOT_CANCELLABLE',
        'The cafe has already started your order. Please contact them directly.',
        { from, to, elapsedMinutes },
      );
    }
  }

  return ok(rule);
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  context: TransitionContext,
): boolean {
  return checkTransition(from, to, context).ok;
}

/**
 * Ordered checkpoints for the customer-facing timeline. Cancellations are rendered
 * separately, since a cancelled order has no meaningful progress to show.
 */
export const ORDER_PROGRESS_STEPS: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.PICKED_UP,
];

/** Index into `ORDER_PROGRESS_STEPS`; -1 for cancelled orders. */
export function progressIndex(status: OrderStatus): number {
  if (status === OrderStatus.COMPLETED) return ORDER_PROGRESS_STEPS.length - 1;
  return ORDER_PROGRESS_STEPS.indexOf(status);
}

/** Sort key for the merchant board: oldest, most urgent work first. */
export function statusUrgencyRank(status: OrderStatus): number {
  const ranks: Record<OrderStatus, number> = {
    PENDING: 0,
    PREPARING: 1,
    ACCEPTED: 2,
    READY: 3,
    PICKED_UP: 4,
    COMPLETED: 5,
    CANCELLED_BY_CUSTOMER: 6,
    CANCELLED_BY_CAFE: 6,
    CANCELLED_BY_ADMIN: 6,
    EXPIRED: 6,
  };
  return ranks[status];
}

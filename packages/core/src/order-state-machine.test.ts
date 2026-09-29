import { describe, expect, it } from 'vitest';
import { ActorType, OrderStatus } from '@grabgo/types';
import {
  allowedTransitions,
  checkTransition,
  isTerminalStatus,
  progressIndex,
} from './order-state-machine';

const merchant = { actor: ActorType.MERCHANT } as const;
const customer = { actor: ActorType.CUSTOMER } as const;
const admin = { actor: ActorType.ADMIN } as const;

describe('order state machine', () => {
  it('walks the happy path', () => {
    expect(checkTransition(OrderStatus.PENDING, OrderStatus.ACCEPTED, merchant).ok).toBe(true);
    expect(checkTransition(OrderStatus.ACCEPTED, OrderStatus.PREPARING, merchant).ok).toBe(true);
    expect(checkTransition(OrderStatus.PREPARING, OrderStatus.READY, merchant).ok).toBe(true);
    expect(
      checkTransition(OrderStatus.READY, OrderStatus.PICKED_UP, {
        ...merchant,
        pickupVerified: true,
      }).ok,
    ).toBe(true);
    expect(
      checkTransition(OrderStatus.PICKED_UP, OrderStatus.COMPLETED, {
        actor: ActorType.SYSTEM,
      }).ok,
    ).toBe(true);
  });

  it('lets a barista skip PREPARING for a fast drink', () => {
    expect(checkTransition(OrderStatus.ACCEPTED, OrderStatus.READY, merchant).ok).toBe(true);
  });

  it('refuses to move a completed order backwards', () => {
    const result = checkTransition(OrderStatus.COMPLETED, OrderStatus.PREPARING, admin);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('refuses to revive a cancelled order', () => {
    const result = checkTransition(
      OrderStatus.CANCELLED_BY_CAFE,
      OrderStatus.READY,
      merchant,
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a no-op transition', () => {
    const result = checkTransition(OrderStatus.READY, OrderStatus.READY, merchant);
    expect(result.ok).toBe(false);
  });

  it('will not skip straight from PENDING to READY', () => {
    expect(checkTransition(OrderStatus.PENDING, OrderStatus.READY, merchant).ok).toBe(false);
  });

  it('blocks pickup without a verified code', () => {
    const result = checkTransition(OrderStatus.READY, OrderStatus.PICKED_UP, merchant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_INVALID');
  });

  it('requires a reason when the cafe cancels', () => {
    const withoutReason = checkTransition(
      OrderStatus.PREPARING,
      OrderStatus.CANCELLED_BY_CAFE,
      merchant,
    );
    expect(withoutReason.ok).toBe(false);
    if (!withoutReason.ok) expect(withoutReason.code).toBe('VALIDATION_ERROR');

    const withReason = checkTransition(
      OrderStatus.PREPARING,
      OrderStatus.CANCELLED_BY_CAFE,
      { ...merchant, reason: 'ITEM_UNAVAILABLE' },
    );
    expect(withReason.ok).toBe(true);
  });

  describe('actor authorisation', () => {
    it('stops a customer accepting their own order', () => {
      const result = checkTransition(OrderStatus.PENDING, OrderStatus.ACCEPTED, customer);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FORBIDDEN');
    });

    it('stops a merchant issuing an admin cancellation', () => {
      const result = checkTransition(
        OrderStatus.PENDING,
        OrderStatus.CANCELLED_BY_ADMIN,
        merchant,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FORBIDDEN');
    });

    it('only lets the system expire an unaccepted order', () => {
      expect(checkTransition(OrderStatus.PENDING, OrderStatus.EXPIRED, merchant).ok).toBe(false);
      expect(
        checkTransition(OrderStatus.PENDING, OrderStatus.EXPIRED, {
          actor: ActorType.SYSTEM,
        }).ok,
      ).toBe(true);
    });
  });

  describe('customer cancellation window', () => {
    const acceptedAt = new Date('2026-09-06T10:00:00Z');

    it('allows a cancel before acceptance with no window at all', () => {
      expect(
        checkTransition(OrderStatus.PENDING, OrderStatus.CANCELLED_BY_CUSTOMER, customer).ok,
      ).toBe(true);
    });

    it('allows a cancel inside the grace period after acceptance', () => {
      const result = checkTransition(
        OrderStatus.ACCEPTED,
        OrderStatus.CANCELLED_BY_CUSTOMER,
        {
          ...customer,
          acceptedAt,
          customerCancelWindowMinutes: 2,
          now: new Date('2026-09-06T10:01:00Z'),
        },
      );
      expect(result.ok).toBe(true);
    });

    it('refuses once the cafe has started making it', () => {
      const result = checkTransition(
        OrderStatus.ACCEPTED,
        OrderStatus.CANCELLED_BY_CUSTOMER,
        {
          ...customer,
          acceptedAt,
          customerCancelWindowMinutes: 2,
          now: new Date('2026-09-06T10:05:00Z'),
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('ORDER_NOT_CANCELLABLE');
    });

    it('does not apply the window to an admin acting for the customer', () => {
      const result = checkTransition(
        OrderStatus.ACCEPTED,
        OrderStatus.CANCELLED_BY_CUSTOMER,
        { actor: ActorType.ADMIN, acceptedAt, now: new Date('2026-09-06T11:00:00Z') },
      );
      expect(result.ok).toBe(true);
    });
  });

  it('lists what each actor may do next', () => {
    expect(allowedTransitions(OrderStatus.PENDING, ActorType.MERCHANT)).toEqual([
      OrderStatus.ACCEPTED,
      OrderStatus.CANCELLED_BY_CAFE,
    ]);
    expect(allowedTransitions(OrderStatus.COMPLETED, ActorType.ADMIN)).toEqual([]);
  });

  it('identifies terminal states', () => {
    expect(isTerminalStatus(OrderStatus.COMPLETED)).toBe(true);
    expect(isTerminalStatus(OrderStatus.EXPIRED)).toBe(true);
    expect(isTerminalStatus(OrderStatus.READY)).toBe(false);
  });

  it('maps statuses onto the customer timeline', () => {
    expect(progressIndex(OrderStatus.PENDING)).toBe(0);
    expect(progressIndex(OrderStatus.PREPARING)).toBe(2);
    expect(progressIndex(OrderStatus.COMPLETED)).toBe(4);
    expect(progressIndex(OrderStatus.CANCELLED_BY_CAFE)).toBe(-1);
  });
});

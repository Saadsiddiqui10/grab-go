import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentProvider, VerifyPaymentResult } from './provider';

/**
 * Settlement under concurrency.
 *
 * The client's confirm call and the provider's webhook routinely arrive at the
 * same moment. These tests drive `confirmPayment` against an in-memory stand-in
 * for Prisma so the interleaving is deterministic: both callers read the payment
 * before either writes, exactly as they would in production.
 */

interface PaymentRow {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  status: string;
  providerPaymentId: string | null;
  failureReason: string | null;
  order: { id: string; businessId: string; userId: string };
}

const store = vi.hoisted(() => ({
  payment: null as PaymentRow | null,
  transactions: [] as Array<{ type: string; status: string; amount: number }>,
}));

const emitted = vi.hoisted(() => ({ count: 0 }));
const posEvents = vi.hoisted(() => ({ queued: [] as string[] }));

// The POS outbox has its own tests; here it only has to be told once.
vi.mock('../pos/pos.service', () => ({
  enqueueOrderEvent: async (_tx: unknown, _order: unknown, event: string) => {
    posEvents.queued.push(event);
  },
  flushOrderJobs: async () => undefined,
}));

vi.mock('../../realtime', () => ({
  emitPaymentChanged: () => {
    emitted.count += 1;
  },
}));

vi.mock('../../db', () => {
  const payment = {
    findUnique: async () => (store.payment ? { ...store.payment } : null),
    findUniqueOrThrow: async () => {
      if (!store.payment) throw new Error('not found');
      return { status: store.payment.status, failureReason: store.payment.failureReason };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status: { in: string[] } };
      data: Partial<PaymentRow>;
    }) => {
      const row = store.payment;
      if (!row || row.id !== where.id || !where.status.in.includes(row.status)) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    },
  };
  const paymentTransaction = {
    create: async ({ data }: { data: { type: string; status: string; amount: number } }) => {
      store.transactions.push(data);
      return data;
    },
  };
  const order = {
    findUniqueOrThrow: async () => ({ id: 'order_1', businessId: 'biz_1' }),
  };
  const tx = { payment, paymentTransaction, order };
  return {
    prisma: {
      ...tx,
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

const { confirmPayment, setPaymentProvider } = await import('./index');

function stubProvider(verify: () => Promise<VerifyPaymentResult>): PaymentProvider {
  return {
    name: 'stub',
    createPayment: vi.fn(),
    verifyPayment: vi.fn(verify),
    refund: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    parseWebhook: vi.fn(),
  } as unknown as PaymentProvider;
}

beforeEach(() => {
  store.payment = {
    id: 'pay_1',
    orderId: 'order_1',
    userId: 'user_1',
    amount: 65000,
    status: 'PENDING',
    providerPaymentId: 'prov_1',
    failureReason: null,
    order: { id: 'order_1', businessId: 'biz_1', userId: 'user_1' },
  };
  store.transactions = [];
  emitted.count = 0;
  posEvents.queued = [];
});

describe('confirmPayment', () => {
  it('records a capture once when the client and the webhook confirm together', async () => {
    setPaymentProvider(stubProvider(async () => ({ status: 'PAID', amount: 65000 })));

    const [fromClient, fromWebhook] = await Promise.all([
      confirmPayment('pay_1', 'user_1'),
      confirmPayment('pay_1', null),
    ]);

    expect(fromClient.status).toBe('PAID');
    expect(fromWebhook.status).toBe('PAID');
    expect(store.transactions.filter((t) => t.type === 'CAPTURE')).toHaveLength(1);
    expect(emitted.count).toBe(1);
    // ...and the café's POS hears about the payment once, too.
    expect(posEvents.queued).toEqual(['order.paid']);
  });

  it('does not let a stale decline overwrite a payment settled meanwhile', async () => {
    // The provider answers "not paid" but, while it was being asked, the other
    // caller settled the payment.
    setPaymentProvider(
      stubProvider(async () => {
        store.payment!.status = 'PAID';
        return { status: 'FAILED', amount: 0, failureReason: 'Timed out' };
      }),
    );

    const result = await confirmPayment('pay_1', 'user_1');

    expect(result.status).toBe('PAID');
    expect(store.payment!.status).toBe('PAID');
    expect(store.transactions).toHaveLength(0);
  });

  it('never moves a refunded payment back to paid', async () => {
    store.payment!.status = 'REFUNDED';
    const provider = stubProvider(async () => ({ status: 'PAID', amount: 65000 }));
    setPaymentProvider(provider);

    const result = await confirmPayment('pay_1', null);

    expect(result.status).toBe('REFUNDED');
    expect(provider.verifyPayment).not.toHaveBeenCalled();
    expect(store.transactions).toHaveLength(0);
  });

  it('still records an ordinary decline', async () => {
    setPaymentProvider(
      stubProvider(async () => ({ status: 'FAILED', amount: 0, failureReason: 'Card declined' })),
    );

    const result = await confirmPayment('pay_1', 'user_1');

    expect(result).toEqual({ status: 'FAILED', failureReason: 'Card declined' });
    expect(store.payment!.status).toBe('FAILED');
    expect(store.transactions).toEqual([
      expect.objectContaining({ type: 'CHARGE', status: 'FAILED' }),
    ]);
  });

  it('treats an under-capture as a failure', async () => {
    setPaymentProvider(stubProvider(async () => ({ status: 'PAID', amount: 1000 })));

    const result = await confirmPayment('pay_1', 'user_1');

    expect(result.status).toBe('FAILED');
    expect(store.payment!.status).toBe('FAILED');
    expect(emitted.count).toBe(0);
  });
});

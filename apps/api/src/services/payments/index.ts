import type { PaymentMethod, PaymentStatus } from '@prisma/client';
import { computeRefundSplit, computeSettlement } from '@grabgo/core';
import { getEnv } from '../../env';
import { prisma, type Tx } from '../../db';
import { HttpError, notFound } from '../../lib/http-error';
import { emitPaymentChanged } from '../../realtime';
import { MockPaymentProvider } from './mock.provider';
import type { PaymentProvider } from './provider';

export * from './provider';

/**
 * Payment orchestration.
 *
 * The invariant this module exists to hold: **an order becomes PAID only after
 * the server has asked the provider and been told so.** `confirmPayment` takes no
 * status from the caller — it takes a payment id, calls out, and records what it
 * is told. A malicious client can call it as often as it likes and will never
 * turn a declined card into a coffee.
 */

let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;

  const env = getEnv();
  switch (env.PAYMENT_PROVIDER) {
    case 'mock':
      provider = new MockPaymentProvider(env.PAYMENT_WEBHOOK_SECRET ?? 'mock-webhook-secret');
      break;
    case 'safepay':
      // Implement `PaymentProvider` against Safepay and register it here. The
      // interface is deliberately small so this stays a single new file.
      throw new Error(
        'Safepay provider is not implemented yet. Set PAYMENT_PROVIDER=mock for development.',
      );
    default:
      throw new Error(`Unknown payment provider: ${String(env.PAYMENT_PROVIDER)}`);
  }

  return provider;
}

/** Test seam: swap the provider without touching env. */
export function setPaymentProvider(next: PaymentProvider | null): void {
  provider = next;
}

/* ------------------------------------------------------------------ creating */

export async function createPaymentForOrder(
  tx: Tx,
  order: {
    id: string;
    orderNumber: string;
    userId: string;
    total: number;
    currency: string;
  },
  method: PaymentMethod,
): Promise<{ paymentId: string; status: PaymentStatus }> {
  // Cash on pickup has no gateway leg: the cafe takes the money at the counter,
  // and the order is simply owed until then.
  if (method === 'CASH_ON_PICKUP') {
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        provider: 'cash',
        method,
        status: 'PENDING',
        amount: order.total,
        currency: order.currency,
      },
      select: { id: true, status: true },
    });
    return { paymentId: payment.id, status: payment.status };
  }

  const payment = await tx.payment.create({
    data: {
      orderId: order.id,
      userId: order.userId,
      provider: getPaymentProvider().name,
      method,
      status: 'PENDING',
      amount: order.total,
      currency: order.currency,
    },
    select: { id: true, status: true },
  });

  return { paymentId: payment.id, status: payment.status };
}

/** Ask the provider to open a charge and hand the client whatever it needs. */
export async function initiatePayment(
  paymentId: string,
  userId: string,
  options: { providerToken?: string; returnUrl?: string } = {},
): Promise<{
  paymentId: string;
  status: PaymentStatus;
  redirectUrl?: string;
  clientToken?: string;
}> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { orderNumber: true, id: true } }, user: { select: { email: true, phone: true } } },
  });

  if (!payment || payment.userId !== userId) throw notFound('That payment');

  if (payment.status === 'PAID') {
    throw new HttpError('PAYMENT_ALREADY_SETTLED', 'This order has already been paid.');
  }

  if (payment.method === 'CASH_ON_PICKUP') {
    return { paymentId: payment.id, status: payment.status };
  }

  const gateway = getPaymentProvider();
  const result = await gateway.createPayment({
    orderId: payment.orderId,
    orderNumber: payment.order.orderNumber,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    customerEmail: payment.user.email,
    customerPhone: payment.user.phone,
    providerToken: options.providerToken,
    returnUrl: options.returnUrl,
    idempotencyKey: payment.id,
  });

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: result.providerPaymentId,
        status: result.status,
      },
    }),
    prisma.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        type: 'AUTHORIZATION',
        status: result.status,
        amount: payment.amount,
        providerReference: result.providerPaymentId,
        rawPayload: (result.raw as object) ?? undefined,
      },
    }),
  ]);

  return {
    paymentId: payment.id,
    status: result.status,
    ...(result.redirectUrl ? { redirectUrl: result.redirectUrl } : {}),
    ...(result.clientToken ? { clientToken: result.clientToken } : {}),
  };
}

/**
 * Settle a payment against the provider's own record.
 *
 * Note what is *not* a parameter: any notion of success supplied by the caller.
 */
export async function confirmPayment(
  paymentId: string,
  userId: string | null,
): Promise<{ status: PaymentStatus; failureReason?: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { id: true, businessId: true, userId: true } } },
  });

  if (!payment) throw notFound('That payment');
  if (userId && payment.userId !== userId) throw notFound('That payment');

  // Settled or refunded payments are final. Re-verifying a refunded payment must
  // not flip it back to PAID because a late webhook arrived.
  if (!SETTLEABLE_STATUSES.includes(payment.status)) {
    return { status: payment.status };
  }

  if (!payment.providerPaymentId) {
    throw new HttpError('PAYMENT_NOT_VERIFIED', 'This payment has not been started yet.');
  }

  const verification = await getPaymentProvider().verifyPayment(payment.providerPaymentId);

  // Guard against a partial capture or a tampered amount: paying less than the
  // order total is not paying.
  if (verification.status === 'PAID' && verification.amount < payment.amount) {
    return failOrCurrent(
      payment.id,
      'Captured amount is less than the order total',
      'Captured amount did not match the order.',
    );
  }

  if (verification.status !== 'PAID') {
    const reason = verification.failureReason ?? 'Payment was declined';
    const outcome = await failOrCurrent(payment.id, reason, reason);
    // Report the provider's own status (e.g. PENDING) unless someone else
    // already settled the payment while we were asking.
    return outcome.status === 'FAILED' ? { status: verification.status, failureReason: reason } : outcome;
  }

  // The client's confirm call and the provider's webhook routinely arrive
  // together. Both read "not paid" above; the conditional update below lets
  // exactly one of them record the capture and announce it.
  const settled = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: SETTLEABLE_STATUSES } },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        providerReference: verification.providerReference ?? null,
        failureReason: null,
      },
    });

    if (claimed.count === 0) return false;

    await tx.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        type: 'CAPTURE',
        status: 'PAID',
        amount: verification.amount,
        providerReference: verification.providerReference ?? null,
        rawPayload: (verification.raw as object) ?? undefined,
      },
    });

    return true;
  });

  if (!settled) return currentStatus(payment.id);

  emitPaymentChanged(
    { orderId: payment.orderId, paymentStatus: 'PAID', at: new Date().toISOString() },
    payment.order.userId,
    payment.order.businessId,
  );

  return { status: 'PAID' };
}

/** Statuses a verification is still allowed to move. */
const SETTLEABLE_STATUSES: PaymentStatus[] = ['PENDING', 'AUTHORIZED', 'FAILED'];

/**
 * Record a failed attempt — unless a concurrent confirmation already settled the
 * payment, in which case a stale "not paid" answer must not overwrite it.
 */
async function markPaymentFailed(paymentId: string, reason: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: SETTLEABLE_STATUSES } },
      data: { status: 'FAILED', failureReason: reason },
    });

    if (updated.count === 0) return false;

    await tx.paymentTransaction.create({
      data: { paymentId, type: 'CHARGE', status: 'FAILED', amount: 0 },
    });

    return true;
  });
}

async function failOrCurrent(
  paymentId: string,
  reason: string,
  failureReason: string,
): Promise<{ status: PaymentStatus; failureReason?: string }> {
  if (await markPaymentFailed(paymentId, reason)) {
    return { status: 'FAILED', failureReason };
  }
  return currentStatus(paymentId);
}

async function currentStatus(
  paymentId: string,
): Promise<{ status: PaymentStatus; failureReason?: string }> {
  const latest = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { status: true, failureReason: true },
  });
  return latest.failureReason
    ? { status: latest.status, failureReason: latest.failureReason }
    : { status: latest.status };
}

/* ------------------------------------------------------------------- refunds */

export async function refundOrder(
  orderId: string,
  amount: number | null,
  reason: string,
): Promise<{ refundedAmount: number; status: PaymentStatus }> {
  const payment = await prisma.payment.findUnique({
    where: { orderId },
    include: { order: true },
  });

  if (!payment) throw notFound('That payment');

  if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_REFUNDED') {
    throw new HttpError('REFUND_FAILED', 'This order has not been paid, so it cannot be refunded.');
  }

  const remaining = payment.amount - payment.refundedAmount;
  const requested = amount ?? remaining;

  if (requested <= 0 || requested > remaining) {
    throw new HttpError('REFUND_FAILED', 'That refund amount is not valid for this order.');
  }

  let refundedAmount = requested;
  let providerReference: string | undefined;

  if (payment.method !== 'CASH_ON_PICKUP' && payment.providerPaymentId) {
    const result = await getPaymentProvider().refund(payment.providerPaymentId, requested);
    refundedAmount = result.refundedAmount;
    providerReference = result.providerReference;
  }

  const totalRefunded = payment.refundedAmount + refundedAmount;
  const status: PaymentStatus =
    totalRefunded >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

  // Recompute the split so the merchant statement reflects the clawback rather
  // than showing earnings on money that went back to the customer.
  const settlement = computeSettlement({
    subtotal: payment.order.subtotal,
    discountTotal: payment.order.discountTotal,
    tax: payment.order.tax,
    total: payment.order.total,
    commissionBasisPoints: payment.order.commissionBasisPoints,
    discountFundedBy: payment.order.discountFundedBy,
  });
  const split = computeRefundSplit(settlement, totalRefunded);

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status, refundedAmount: totalRefunded },
    }),
    prisma.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        type: 'REFUND',
        status,
        amount: refundedAmount,
        providerReference: providerReference ?? null,
        rawPayload: { reason },
      },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        merchantEarnings: settlement.merchantEarnings - split.merchantClawback,
        platformCommission: settlement.platformCommission - split.platformClawback,
      },
    }),
  ]);

  emitPaymentChanged(
    { orderId, paymentStatus: status, at: new Date().toISOString() },
    payment.order.userId,
    payment.order.businessId,
  );

  return { refundedAmount, status };
}

/** Webhook path: same verification, no user session. */
export async function handleWebhookEvent(rawBody: string, signature: string): Promise<void> {
  const gateway = getPaymentProvider();

  if (!gateway.verifyWebhookSignature(rawBody, signature)) {
    throw new HttpError('FORBIDDEN', 'Invalid webhook signature.');
  }

  const event = gateway.parseWebhook(rawBody);
  const payment = await prisma.payment.findFirst({
    where: { providerPaymentId: event.providerPaymentId },
    select: { id: true, userId: true },
  });

  if (!payment) return;

  // Re-verify rather than trusting the webhook body, so a forged-but-signed
  // replay still cannot invent a successful capture.
  await confirmPayment(payment.id, null);
}

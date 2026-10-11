import {
  checkTransition,
  computeSettlement,
  estimateReadyMinutes,
  generateOrderNumber,
  generatePickupCode,
  isTerminalStatus,
  verifyPickupCode,
} from '@grabgo/core';
import { ActorType, type OrderDetail, type OrderSummary } from '@grabgo/types';
import type {
  ActorType as PrismaActorType,
  OrderRejectionReason,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import type { CreateOrderInput } from '@grabgo/validation';
import { prisma, type DbOrTx, type Tx } from '../db';
import { getEnv } from '../env';
import { expect, forbidden, HttpError, notFound } from '../lib/http-error';
import { randomBytes } from '../lib/crypto';
import { signPickupToken } from '../lib/tokens';
import {
  orderWithRelations,
  toOrderDetail,
  toOrderSummary,
  type OrderWithRelations,
} from '../mappers';
import { assertCanAcceptOrder, computeAvailability, loadBusiness } from './business.service';
import { priceCart } from './pricing.service';
import { createPaymentForOrder } from './payments';
import {
  awardOrderPoints,
  consumeRedemption,
  releaseRedemption,
  reverseOrderPoints,
} from './loyalty.service';
import { evaluateReferralOnOrder } from './referral.service';
import { getLoyaltyConfig, getPlatformConfig } from './settings.service';
import { emitOrderCreated, emitOrderStatusChanged, emitPointsChanged } from '../realtime';
import { notifyOrderStatus, notifyRewardUnlocked } from './notification.service';

/**
 * Orders.
 *
 * Everything that can change an order's money or state passes through here, and
 * two rules are enforced without exception:
 *
 *   1. Totals are computed from the live menu, never read from the request.
 *   2. Status changes go through the state machine in `@grabgo/core`, so an
 *      invalid transition is impossible rather than merely unlikely.
 */

const CODE_GENERATION_ATTEMPTS = 5;

export interface OrderActor {
  userId: string;
  type: PrismaActorType;
  /** Businesses this actor staffs, used to authorise merchant actions. */
  businesses?: string[];
  isAdmin?: boolean;
}

/* ------------------------------------------------------------------ creating */

export interface CreateOrderContext {
  userId: string;
  input: CreateOrderInput;
  now?: Date;
}

export async function createOrder(context: CreateOrderContext): Promise<OrderDetail> {
  const now = context.now ?? new Date();
  const { input, userId } = context;

  // A retried checkout returns the order the first attempt created rather than
  // charging twice. Checked before any work, and again via the unique index below.
  const existing = await prisma.order.findFirst({
    where: { userId, idempotencyKey: input.idempotencyKey },
    ...orderWithRelations,
  });
  if (existing) return presentOrder(existing, { viewerId: userId, now });

  const business = await loadBusiness(prisma, input.businessId);

  const activeCount = await prisma.order.count({
    where: { businessId: business.id, status: { in: ['ACCEPTED', 'PREPARING'] } },
  });
  const availability = computeAvailability(business, activeCount, now);

  const pickupAt =
    input.pickup.mode === 'ASAP'
      ? new Date(now.getTime() + availability.effectiveLeadMinutes * 60_000)
      : new Date(input.pickup.pickupAt as string);

  if (Number.isNaN(pickupAt.getTime())) {
    throw new HttpError('INVALID_PICKUP_TIME', 'That pickup time is not valid.');
  }

  await assertCanAcceptOrder(prisma, business, pickupAt, now);

  // Strict pricing: at checkout a sold-out item or a dead promo must fail the
  // request, not silently reshape the basket the customer just approved.
  const quote = await priceCart(prisma, {
    businessId: business.id,
    userId,
    lines: input.lines,
    promoCode: input.promoCode ?? null,
    redemptionId: input.redemptionId ?? null,
    strict: true,
    now,
  });

  if (quote.totals.total < 0) {
    throw new HttpError('INTERNAL_ERROR', 'We could not price this order.');
  }

  const settlement = computeSettlement({
    subtotal: quote.totals.subtotal,
    discountTotal: quote.totals.discountTotal,
    tax: quote.totals.tax,
    total: quote.totals.total,
    commissionBasisPoints: business.commissionBasisPoints,
    discountFundedBy: quote.discountFundedBy,
  });

  const prepMinutes = estimateReadyMinutes(
    quote.lines.map(() => business.prepTimeMinutes),
    business.prepTimeMinutes,
  );

  const created = await prisma.$transaction(async (tx) => {
    const order = await createOrderRow(tx, {
      businessId: business.id,
      userId,
      pickupMode: input.pickup.mode,
      pickupAt,
      prepMinutes,
      customerNote: input.customerNote ?? null,
      collection: input.collection,
      quote,
      settlement,
      commissionBasisPoints: business.commissionBasisPoints,
      idempotencyKey: input.idempotencyKey,
    });

    if (quote.redemptionId) {
      await consumeRedemption(tx, quote.redemptionId, order.id);
    }

    if (quote.promotionId) {
      await recordPromoRedemption(tx, {
        promotionId: quote.promotionId,
        userId,
        orderId: order.id,
        discountAmount: quote.totals.promoDiscount,
      });
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: 'PENDING',
        actorType: 'CUSTOMER',
        actorUserId: userId,
      },
    });

    await createPaymentForOrder(
      tx,
      {
        id: order.id,
        orderNumber: order.orderNumber,
        userId,
        total: quote.totals.total,
        currency: quote.totals.currency,
      },
      input.paymentMethod as PaymentMethod,
    );

    return tx.order.findUniqueOrThrow({ where: { id: order.id }, ...orderWithRelations });
  });

  const summary = toOrderSummary(created);
  emitOrderCreated(summary, userId);

  return presentOrder(created, { viewerId: userId, now });
}

interface CreateOrderRowInput {
  businessId: string;
  userId: string;
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt: Date;
  prepMinutes: number;
  customerNote: string | null;
  /** Walk-in, or curbside with the car's plate (validated by the schema). */
  collection:
    | { method: 'WALK_IN' }
    | { method: 'CURBSIDE'; vehiclePlate: string; vehicleDetails?: string | null };
  quote: Awaited<ReturnType<typeof priceCart>>;
  settlement: ReturnType<typeof computeSettlement>;
  commissionBasisPoints: number;
  idempotencyKey: string;
}

/**
 * Insert the order and its snapshot lines.
 *
 * Order number and pickup code are random, so a collision is possible in
 * principle; the unique index catches it and we draw again rather than trusting
 * the odds.
 */
async function createOrderRow(
  tx: Tx,
  input: CreateOrderRowInput,
): Promise<{ id: string; orderNumber: string }> {
  const { quote } = input;

  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      return await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(randomBytes),
          pickupCode: generatePickupCode(randomBytes),
          businessId: input.businessId,
          userId: input.userId,
          status: 'PENDING',
          type: 'PICKUP',
          pickupMode: input.pickupMode,
          pickupAt: input.pickupAt,
          estimatedReadyAt: input.pickupAt,
          prepTimeMinutes: input.prepMinutes,
          customerNote: input.customerNote,
          pickupMethod: input.collection.method,
          vehiclePlate: input.collection.method === 'CURBSIDE' ? input.collection.vehiclePlate : null,
          vehicleDetails:
            input.collection.method === 'CURBSIDE' ? (input.collection.vehicleDetails ?? null) : null,

          subtotal: quote.totals.subtotal,
          promoDiscount: quote.totals.promoDiscount,
          rewardDiscount: quote.totals.rewardDiscount,
          discountTotal: quote.totals.discountTotal,
          tax: quote.totals.tax,
          total: quote.totals.total,
          currency: quote.totals.currency,

          commissionBasisPoints: input.commissionBasisPoints,
          platformCommission: input.settlement.platformCommission,
          merchantEarnings: input.settlement.merchantEarnings,
          discountFundedBy: quote.discountFundedBy,

          promotionId: quote.promotionId,
          promoCode: quote.appliedPromoCode,
          idempotencyKey: input.idempotencyKey,

          items: {
            create: quote.lines.map((line) => ({
              menuItemId: line.menuItemId,
              variantId: line.variant?.id ?? null,
              name: line.name,
              imageUrl: line.imageUrl,
              variantName: line.variant?.name ?? null,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              lineTotal: line.lineTotal,
              notes: line.notes,
              modifiers: {
                create: line.modifiers.map((modifier) => ({
                  modifierOptionId: modifier.optionId,
                  modifierName: modifier.modifierName,
                  optionName: modifier.optionName,
                  priceDelta: modifier.priceDelta,
                })),
              },
            })),
          },
        },
        select: { id: true, orderNumber: true },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const target = String((error as { meta?: { target?: unknown } }).meta?.target ?? '');

      // The idempotency index firing means a concurrent duplicate won the race.
      if (code === 'P2002' && target.includes('idempotencyKey')) {
        const winner = await tx.order.findFirstOrThrow({
          where: { userId: input.userId, idempotencyKey: input.idempotencyKey },
          select: { id: true, orderNumber: true },
        });
        return winner;
      }

      if (code === 'P2002' && attempt < CODE_GENERATION_ATTEMPTS - 1) continue;
      throw error;
    }
  }

  throw new HttpError('INTERNAL_ERROR', 'We could not create your order. Please try again.');
}

async function recordPromoRedemption(
  tx: Tx,
  input: { promotionId: string; userId: string; orderId: string; discountAmount: number },
): Promise<void> {
  await tx.promoRedemption.create({
    data: {
      promotionId: input.promotionId,
      userId: input.userId,
      orderId: input.orderId,
      discountAmount: input.discountAmount,
    },
  });

  await tx.promotion.update({
    where: { id: input.promotionId },
    data: { usageCount: { increment: 1 } },
  });
}

/* ----------------------------------------------------------------- presenting */

export interface PresentOptions {
  viewerId: string | null;
  /** Set for merchant/admin viewers, who may see the code to read it back. */
  isStaffViewer?: boolean;
  now?: Date;
}

export async function presentOrder(
  order: OrderWithRelations,
  options: PresentOptions,
): Promise<OrderDetail> {
  const now = options.now ?? new Date();
  const isCustomer = options.viewerId === order.userId;
  const includePickupCode = isCustomer || options.isStaffViewer === true;

  const platform = await getPlatformConfig(prisma);

  const canCancel =
    isCustomer &&
    checkTransition(order.status, 'CANCELLED_BY_CUSTOMER', {
      actor: ActorType.CUSTOMER,
      now,
      acceptedAt: order.acceptedAt,
      customerCancelWindowMinutes: platform.customerCancelWindowMinutes,
    }).ok;

  const canReview =
    isCustomer &&
    (order.status === 'PICKED_UP' || order.status === 'COMPLETED') &&
    order.review === null;

  // The QR is minted per request and short-lived, so a screenshot stops working
  // while the customer's own screen keeps refreshing it.
  const pickupQrToken =
    includePickupCode && order.status !== 'PICKED_UP' && !isTerminalStatus(order.status)
      ? await signPickupToken(
          order.id,
          order.orderNumber,
          order.pickupCode,
          getEnv().PICKUP_TOKEN_SECRET,
        )
      : null;

  return toOrderDetail(order, {
    includePickupCode,
    pickupQrToken,
    canCancel,
    canReview,
  });
}

export async function getOrderForViewer(
  orderId: string,
  actor: OrderActor,
): Promise<OrderDetail> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    ...orderWithRelations,
  });

  if (!order) throw notFound('That order');

  const isCustomer = order.userId === actor.userId;
  const isStaff = actor.businesses?.includes(order.businessId) ?? false;

  if (!isCustomer && !isStaff && !actor.isAdmin) throw notFound('That order');

  return presentOrder(order, {
    viewerId: actor.userId,
    isStaffViewer: isStaff || actor.isAdmin === true,
  });
}

export async function listOrdersForUser(
  userId: string,
  options: { status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ALL'; cursor?: string | null; limit: number },
): Promise<{ items: OrderSummary[]; nextCursor: string | null; hasMore: boolean }> {
  const statusFilter: Record<typeof options.status, Prisma.OrderWhereInput> = {
    ACTIVE: { status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'] } },
    COMPLETED: { status: { in: ['PICKED_UP', 'COMPLETED'] } },
    CANCELLED: {
      status: {
        in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_CAFE', 'CANCELLED_BY_ADMIN', 'EXPIRED'],
      },
    },
    ALL: {},
  };

  const rows = await prisma.order.findMany({
    where: { userId, ...statusFilter[options.status] },
    ...orderWithRelations,
    orderBy: { createdAt: 'desc' },
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > options.limit;
  const items = hasMore ? rows.slice(0, options.limit) : rows;

  return {
    items: items.map(toOrderSummary),
    hasMore,
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

/* --------------------------------------------------------------- transitions */

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actor: OrderActor;
  reason?: OrderRejectionReason | null;
  note?: string | null;
  prepTimeMinutes?: number;
  /** Set only by the pickup-verification path. */
  pickupVerified?: boolean;
  now?: Date;
}

/**
 * The single gate every status change passes through.
 *
 * Loads the order, asks the state machine, applies the change and its side
 * effects in one transaction, then emits realtime and push *after* the commit —
 * so nobody is told an order is ready before that is durably true.
 */
export async function transitionOrder(input: TransitionInput): Promise<OrderDetail> {
  const now = input.now ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      ...orderWithRelations,
    });

    if (!order) throw notFound('That order');

    assertActorMayTouch(order, input.actor);

    const platform = await getPlatformConfig(tx);

    expect(
      checkTransition(order.status, input.to, {
        actor: input.actor.type,
        now,
        reason: input.reason ?? null,
        pickupVerified: input.pickupVerified ?? false,
        acceptedAt: order.acceptedAt,
        customerCancelWindowMinutes: platform.customerCancelWindowMinutes,
      }),
    );

    const data = statusTimestamps(input.to, now, order.status);

    if (input.to === 'ACCEPTED' && input.prepTimeMinutes) {
      data.prepTimeMinutes = input.prepTimeMinutes;
      data.estimatedReadyAt = new Date(now.getTime() + input.prepTimeMinutes * 60_000);
    }

    if (isCancellation(input.to)) {
      data.cancellationReason = input.reason ?? null;
      data.cancellationNote = input.note ?? null;
    }

    await tx.order.update({ where: { id: order.id }, data: { status: input.to, ...data } });

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: input.to,
        previousStatus: order.status,
        actorType: input.actor.type,
        actorUserId: input.actor.userId,
        note: input.note ?? null,
      },
    });

    const effects = await applySideEffects(tx, order, input.to);

    const updated = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      ...orderWithRelations,
    });

    return { order: updated, previousStatus: order.status, effects };
  });

  // Side channels run after the commit: a failed push must not roll back an order.
  emitOrderStatusChanged(
    {
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      businessId: result.order.businessId,
      status: result.order.status,
      previousStatus: result.previousStatus,
      at: now.toISOString(),
      estimatedReadyAt: result.order.estimatedReadyAt?.toISOString() ?? null,
    },
    result.order.userId,
  );

  void notifyOrderStatus(result.order.status, {
    userId: result.order.userId,
    orderId: result.order.id,
    orderNumber: result.order.orderNumber,
    businessName: result.order.business.name,
  });

  if (result.effects.pointsAwarded > 0) {
    emitPointsChanged(result.order.userId, {
      balance: result.effects.balanceAfter,
      delta: result.effects.pointsAwarded,
      reason: `Order ${result.order.orderNumber}`,
    });
  }

  if (result.effects.referralQualified) {
    void notifyRewardUnlocked(result.order.userId);
  }

  return presentOrder(result.order, {
    viewerId: input.actor.userId,
    isStaffViewer: input.actor.type !== 'CUSTOMER',
  });
}

function assertActorMayTouch(order: OrderWithRelations, actor: OrderActor): void {
  if (actor.isAdmin) return;

  if (actor.type === 'CUSTOMER') {
    if (order.userId !== actor.userId) throw notFound('That order');
    return;
  }

  if (actor.type === 'MERCHANT') {
    if (!actor.businesses?.includes(order.businessId)) {
      throw forbidden('You do not have access to this order.');
    }
    return;
  }

  if (actor.type === 'SYSTEM') return;

  throw forbidden('You do not have access to this order.');
}

function isCancellation(status: OrderStatus): boolean {
  return (
    status === 'CANCELLED_BY_CUSTOMER' ||
    status === 'CANCELLED_BY_CAFE' ||
    status === 'CANCELLED_BY_ADMIN' ||
    status === 'EXPIRED'
  );
}

function statusTimestamps(
  to: OrderStatus,
  now: Date,
  from: OrderStatus,
): Prisma.OrderUncheckedUpdateInput {
  switch (to) {
    case 'ACCEPTED':
      return { acceptedAt: now };
    case 'PREPARING':
      return { preparingAt: now };
    case 'READY':
      // A cafe may jump ACCEPTED -> READY for a fast drink; backfill the
      // preparing timestamp so prep-time analytics are not full of holes.
      return { readyAt: now, ...(from === 'ACCEPTED' ? { preparingAt: now } : {}) };
    case 'PICKED_UP':
      return { pickedUpAt: now };
    case 'COMPLETED':
      return { completedAt: now };
    default:
      return isCancellation(to) ? { cancelledAt: now } : {};
  }
}

interface SideEffects {
  pointsAwarded: number;
  balanceAfter: number;
  referralQualified: boolean;
}

/**
 * What a status change *means* beyond the column.
 *
 * Points and referral qualification fire here, inside the transaction, so they
 * either both happen with the status change or neither does.
 */
async function applySideEffects(
  tx: Tx,
  order: OrderWithRelations,
  to: OrderStatus,
): Promise<SideEffects> {
  const effects: SideEffects = {
    pointsAwarded: 0,
    balanceAfter: 0,
    referralQualified: false,
  };

  if (isCancellation(to)) {
    // Hand the reward code back and free the promo use, so a cancelled order
    // costs the customer nothing.
    if (order.redemptionId) await releaseRedemption(tx, order.redemptionId);

    if (order.promotionId) {
      await tx.promotion.updateMany({
        where: { id: order.promotionId, usageCount: { gt: 0 } },
        data: { usageCount: { decrement: 1 } },
      });
      await tx.promoRedemption.deleteMany({ where: { orderId: order.id } });
    }

    if (order.pointsAwardedAt) {
      await reverseOrderPoints(tx, order.id, `Order ${order.orderNumber} cancelled`);
    }

    return effects;
  }

  const loyalty = await getLoyaltyConfig(tx);
  const businessOptedIn = order.business.loyaltyEnabled;

  if (to === loyalty.awardOnStatus && businessOptedIn && !order.pointsAwardedAt) {
    const points = await awardOrderPoints(tx, {
      id: order.id,
      userId: order.userId,
      businessId: order.businessId,
      orderNumber: order.orderNumber,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
    });

    if (points > 0) {
      effects.pointsAwarded = points;
      const account = await tx.pointsAccount.findUnique({
        where: { userId_businessId: { userId: order.userId, businessId: order.businessId } },
        select: { balance: true },
      });
      effects.balanceAfter = account?.balance ?? points;
    }
  }

  // A referral qualifies off the referred customer's first collected order.
  if (to === 'PICKED_UP' || to === 'COMPLETED') {
    const outcome = await evaluateReferralOnOrder(tx, {
      id: order.id,
      userId: order.userId,
      businessId: order.businessId,
      total: order.total,
      status: to,
    });
    effects.referralQualified = outcome.qualified;
  }

  return effects;
}

/* ------------------------------------------------------- pickup verification */

export interface VerifyPickupInput {
  orderId: string;
  submittedCode: string;
  actor: OrderActor;
  method?: 'CODE' | 'QR';
  ipAddress?: string | null;
}

/**
 * Verify the code at the counter and hand the order over.
 *
 * Every attempt is recorded, wrong attempts increment a counter, and the order
 * locks after the configured number of failures — six characters are only strong
 * enough if guessing is bounded.
 */
export async function verifyPickup(input: VerifyPickupInput): Promise<OrderDetail> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      businessId: true,
      status: true,
      pickupCode: true,
      pickupCodeAttempts: true,
      pickedUpAt: true,
    },
  });

  if (!order) throw notFound('That order');

  if (!input.actor.isAdmin && !input.actor.businesses?.includes(order.businessId)) {
    throw forbidden('You do not have access to this order.');
  }

  const platform = await getPlatformConfig(prisma);

  const result = verifyPickupCode({
    expectedCode: order.pickupCode,
    submittedCode: input.submittedCode,
    attemptCount: order.pickupCodeAttempts,
    maxAttempts: platform.maxPickupCodeAttempts,
    isOrderReady: order.status === 'READY',
    isAlreadyPickedUp: order.pickedUpAt !== null,
  });

  await prisma.pickupVerification.create({
    data: {
      orderId: order.id,
      verifiedByUserId: input.actor.userId,
      method: input.method ?? 'CODE',
      succeeded: result.ok,
      ipAddress: input.ipAddress ?? null,
    },
  });

  if (!result.ok) {
    // Only a wrong code counts against the limit; "not ready yet" is a workflow
    // mistake, not an attack, and must not lock the order.
    if (result.code === 'PICKUP_CODE_INVALID') {
      await prisma.order.update({
        where: { id: order.id },
        data: { pickupCodeAttempts: { increment: 1 } },
      });
    }
    throw new HttpError(result.code, result.message, {
      ...(result.details ? { details: result.details } : {}),
    });
  }

  return transitionOrder({
    orderId: order.id,
    to: 'PICKED_UP',
    actor: input.actor,
    pickupVerified: true,
  });
}

/* --------------------------------------------------------------- order again */

/**
 * Rebuild a previous basket against today's menu.
 *
 * Prices and availability are re-checked, so "Order again" cannot resurrect a
 * discontinued item or last month's price. Anything missing comes back as a
 * warning rather than silently disappearing.
 */
export async function buildReorderCart(
  db: DbOrTx,
  userId: string,
  orderId: string,
): Promise<{
  businessId: string;
  lines: Array<{ menuItemId: string; variantId: string | null; modifierOptionIds: string[]; quantity: number; notes: string | null }>;
  warnings: string[];
}> {
  const order = await db.order.findFirst({
    where: { id: orderId, userId },
    include: { items: { include: { modifiers: true } } },
  });

  if (!order) throw notFound('That order');

  const warnings: string[] = [];
  const lines: Array<{
    menuItemId: string;
    variantId: string | null;
    modifierOptionIds: string[];
    quantity: number;
    notes: string | null;
  }> = [];

  for (const item of order.items) {
    if (!item.menuItemId) {
      warnings.push(`${item.name} is no longer on the menu.`);
      continue;
    }

    const current = await db.menuItem.findFirst({
      where: { id: item.menuItemId, deletedAt: null, isAvailable: true },
      select: { id: true, name: true, isSoldOut: true },
    });

    if (!current) {
      warnings.push(`${item.name} is no longer on the menu.`);
      continue;
    }

    if (current.isSoldOut) {
      warnings.push(`${current.name} is sold out today.`);
      continue;
    }

    lines.push({
      menuItemId: item.menuItemId,
      variantId: item.variantId,
      modifierOptionIds: item.modifiers
        .map((modifier) => modifier.modifierOptionId)
        .filter((id): id is string => id !== null),
      quantity: item.quantity,
      notes: item.notes,
    });
  }

  if (lines.length === 0) {
    throw new HttpError(
      'ITEM_UNAVAILABLE',
      'Nothing from that order is available right now.',
    );
  }

  return { businessId: order.businessId, lines, warnings };
}

/* ------------------------------------------------------------ merchant board */

export async function listBusinessOrders(
  businessId: string,
  options: {
    status: 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'ALL';
    from?: Date;
    to?: Date;
    cursor?: string | null;
    limit: number;
  },
): Promise<{ items: OrderDetail[]; nextCursor: string | null; hasMore: boolean }> {
  const statusFilter: Record<typeof options.status, Prisma.OrderWhereInput> = {
    NEW: { status: 'PENDING' },
    PREPARING: { status: { in: ['ACCEPTED', 'PREPARING'] } },
    READY: { status: 'READY' },
    COMPLETED: { status: { in: ['PICKED_UP', 'COMPLETED'] } },
    CANCELLED: {
      status: {
        in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_CAFE', 'CANCELLED_BY_ADMIN', 'EXPIRED'],
      },
    },
    ALL: {},
  };

  const rows = await prisma.order.findMany({
    where: {
      businessId,
      ...statusFilter[options.status],
      ...(options.from || options.to
        ? {
            createdAt: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            },
          }
        : {}),
    },
    ...orderWithRelations,
    // Oldest first on the live board: the customer who has waited longest is the
    // one the barista should serve next.
    orderBy: [{ pickupAt: 'asc' }, { createdAt: 'asc' }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;

  const items = await Promise.all(
    page.map((order) => presentOrder(order, { viewerId: null, isStaffViewer: true })),
  );

  return {
    items,
    hasMore,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}

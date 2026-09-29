import type { FastifyInstance } from 'fastify';
import {
  cancelOrderSchema,
  confirmPaymentSchema,
  createOrderSchema,
  createReviewSchema,
  initiatePaymentSchema,
  listOrdersQuerySchema,
  quoteCartSchema,
} from '@grabgo/validation';
import { prisma } from '../db';
import { parse } from '../lib/validate';
import { HttpError, notFound, success } from '../lib/http-error';
import { requireAuth } from '../lib/auth-context';
import { priceCart } from '../services/pricing.service';
import { getPickupSlots, loadBusiness } from '../services/business.service';
import {
  buildReorderCart,
  createOrder,
  getOrderForViewer,
  listOrdersForUser,
  transitionOrder,
} from '../services/order.service';
import { confirmPayment, initiatePayment } from '../services/payments';

/**
 * Customer order routes: quoting a cart, checking out, tracking, cancelling,
 * paying and reviewing.
 */
export async function registerOrderRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Price a cart without committing to it.
   *
   * Non-strict: a sold-out line comes back as a warning with the rest of the
   * basket still priced, so the cart screen can say "one item is unavailable"
   * instead of showing an error where the total should be.
   */
  app.post('/cart/quote', async (request) => {
    const principal = await requireAuth(request);
    const body = parse(quoteCartSchema, request.body);

    const business = await loadBusiness(prisma, body.businessId);

    const [quote, pickupSlots] = await Promise.all([
      priceCart(prisma, {
        businessId: business.id,
        userId: principal.userId,
        lines: body.lines,
        promoCode: body.promoCode ?? null,
        redemptionId: body.redemptionId ?? null,
        strict: false,
      }),
      getPickupSlots(prisma, business),
    ]);

    return success({
      businessId: business.id,
      lines: quote.lines,
      totals: quote.totals,
      appliedPromoCode: quote.appliedPromoCode,
      appliedRedemptionId: quote.redemptionId,
      warnings: quote.warnings,
      pickupSlots,
    });
  });

  app.post('/orders', async (request, reply) => {
    const principal = await requireAuth(request);
    const body = parse(createOrderSchema, request.body);

    const order = await createOrder({ userId: principal.userId, input: body });
    return reply.code(201).send(success(order));
  });

  app.get('/orders', async (request) => {
    const principal = await requireAuth(request);
    const query = parse(listOrdersQuerySchema, request.query, 'filters');

    const result = await listOrdersForUser(principal.userId, {
      status: query.status,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });

    return success(result.items, {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  });

  app.get('/orders/:orderId', async (request) => {
    const principal = await requireAuth(request);
    const { orderId } = request.params as { orderId: string };

    const order = await getOrderForViewer(orderId, {
      userId: principal.userId,
      type: 'CUSTOMER',
      businesses: principal.businesses,
      isAdmin: principal.isAdmin,
    });

    return success(order);
  });

  app.post('/orders/:orderId/cancel', async (request) => {
    const principal = await requireAuth(request);
    const { orderId } = request.params as { orderId: string };
    const body = parse(cancelOrderSchema, request.body ?? {});

    const order = await transitionOrder({
      orderId,
      to: 'CANCELLED_BY_CUSTOMER',
      actor: { userId: principal.userId, type: 'CUSTOMER' },
      note: body.reason ?? null,
    });

    return success(order);
  });

  /** Rebuild a past basket against today's menu and prices. */
  app.post('/orders/:orderId/reorder', async (request) => {
    const principal = await requireAuth(request);
    const { orderId } = request.params as { orderId: string };

    const cart = await buildReorderCart(prisma, principal.userId, orderId);

    // Re-quote so the customer sees current prices before they commit, rather
    // than discovering the change at checkout.
    const quote = await priceCart(prisma, {
      businessId: cart.businessId,
      userId: principal.userId,
      lines: cart.lines,
      strict: false,
    });

    return success({
      businessId: cart.businessId,
      lines: cart.lines,
      pricedLines: quote.lines,
      totals: quote.totals,
      warnings: [
        ...cart.warnings.map((message) => ({ code: 'ITEM_REMOVED', message })),
        ...quote.warnings,
      ],
    });
  });

  /* -------------------------------------------------------------- payments */

  app.post('/payments/initiate', async (request) => {
    const principal = await requireAuth(request);
    const body = parse(initiatePaymentSchema, request.body);

    const order = await prisma.order.findFirst({
      where: { id: body.orderId, userId: principal.userId },
      select: { id: true, payment: { select: { id: true } } },
    });

    if (!order?.payment) throw notFound('That order');

    const result = await initiatePayment(order.payment.id, principal.userId, {
      ...(body.providerToken ? { providerToken: body.providerToken } : {}),
      ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
    });

    return success(result);
  });

  /**
   * Settle a payment.
   *
   * The body carries a payment id and nothing else. The server asks the provider
   * what happened; a client claiming success does not make an order paid.
   */
  app.post('/payments/confirm', async (request) => {
    const principal = await requireAuth(request);
    const body = parse(confirmPaymentSchema, request.body);

    const result = await confirmPayment(body.paymentId, principal.userId);

    if (result.status !== 'PAID') {
      throw new HttpError(
        'PAYMENT_FAILED',
        result.failureReason ?? "Payment couldn't be completed. Try another payment method.",
      );
    }

    return success(result);
  });

  /* --------------------------------------------------------------- reviews */

  app.post('/reviews', async (request, reply) => {
    const principal = await requireAuth(request);
    const body = parse(createReviewSchema, request.body);

    const order = await prisma.order.findFirst({
      where: { id: body.orderId, userId: principal.userId },
      select: { id: true, businessId: true, status: true },
    });

    if (!order) throw notFound('That order');

    // Only a collected order can be reviewed, which is what keeps the ratings
    // attached to real experiences.
    if (order.status !== 'PICKED_UP' && order.status !== 'COMPLETED') {
      throw new HttpError(
        'FORBIDDEN',
        'You can review an order once you have collected it.',
      );
    }

    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          businessId: order.businessId,
          userId: principal.userId,
          rating: body.rating,
          comment: body.comment ?? null,
        },
        update: { rating: body.rating, comment: body.comment ?? null },
      });

      // Recompute the cafe's aggregate from the reviews themselves rather than
      // nudging a running average, so an edited review cannot skew it forever.
      const stats = await tx.review.aggregate({
        where: { businessId: order.businessId },
        _avg: { rating: true },
        _count: { _all: true },
      });

      await tx.business.update({
        where: { id: order.businessId },
        data: {
          ratingAverage: stats._avg.rating ?? 0,
          ratingCount: stats._count._all,
        },
      });

      return created;
    });

    return reply.code(201).send(
      success({
        id: review.id,
        orderId: review.orderId,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt.toISOString(),
      }),
    );
  });
}

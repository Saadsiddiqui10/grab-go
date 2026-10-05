import type { FastifyInstance } from 'fastify';
import {
  adminBusinessQuerySchema,
  adminCancelOrderSchema,
  adminRefundOrderSchema,
  adminUserQuerySchema,
  adjustPointsSchema,
  analyticsRangeSchema,
  createAreaSchema,
  createCitySchema,
  loyaltyConfigSchema,
  platformConfigSchema,
  promotionSchema,
  promotionUpdateSchema,
  referralConfigSchema,
  rejectBusinessSchema,
  registerBusinessSchema,
  rewardSchema,
  rewardUpdateSchema,
  suspendUserSchema,
} from '@grabgo/validation';
import { ConfigKey } from '@grabgo/types';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { parse } from '../lib/validate';
import { notFound, success } from '../lib/http-error';
import { clientIp, requireAdmin, userAgent } from '../lib/auth-context';
import { AuditAction, diffFields, recordAudit } from '../services/audit.service';
import {
  getLoyaltyConfig,
  getPlatformConfig,
  getReferralConfig,
  writeSetting,
} from '../services/settings.service';
import { getAdminAnalytics, resolveRange } from '../services/analytics.service';
import { ensureOwner } from '../services/business.service';
import { assertListingReadyForApproval } from './listings.routes';
import { applyPointsDelta } from '../services/loyalty.service';
import { transitionOrder } from '../services/order.service';
import { refundOrder } from '../services/payments';
import { randomToken } from '../lib/crypto';

/**
 * Admin API.
 *
 * Two things run through every mutation here: an admin-only guard, and an audit
 * entry recording who did what, to whom, and what the value was before. Anything
 * that moves someone else's money or access must be answerable later.
 */
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- users */

  app.get('/admin/users', async (request) => {
    await requireAdmin(request);
    const query = parse(adminUserQuerySchema, request.query, 'filters');

    const where: Prisma.UserWhereInput = {
      ...(query.status !== 'ALL' ? { status: query.status } : {}),
      ...(query.role !== 'ALL' ? { role: query.role } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q } },
              { referralCode: { contains: query.q.toUpperCase() } },
              { profile: { fullName: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const rows = await prisma.user.findMany({
      where,
      include: { profile: true, pointsAccount: { select: { balance: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return success(
      items.map((user) => ({
        id: user.id,
        fullName: user.profile?.fullName ?? '',
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        referralCode: user.referralCode,
        pointsBalance: user.pointsAccount?.balance ?? 0,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      })),
      { nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null, hasMore },
    );
  });

  app.get('/admin/users/:userId', async (request) => {
    await requireAdmin(request);
    const { userId } = request.params as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        pointsAccount: true,
        referralsMade: { select: { id: true, status: true } },
        _count: { select: { orders: true } },
      },
    });

    if (!user) throw notFound('That user');

    const recentOrders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        createdAt: true,
        business: { select: { name: true } },
      },
    });

    return success({
      id: user.id,
      fullName: user.profile?.fullName ?? '',
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      referralCode: user.referralCode,
      points: {
        balance: user.pointsAccount?.balance ?? 0,
        lifetimeEarned: user.pointsAccount?.lifetimeEarned ?? 0,
        lifetimeRedeemed: user.pointsAccount?.lifetimeRedeemed ?? 0,
      },
      orderCount: user._count.orders,
      referralCount: user.referralsMade.length,
      createdAt: user.createdAt.toISOString(),
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        businessName: order.business.name,
        createdAt: order.createdAt.toISOString(),
      })),
    });
  });

  app.post('/admin/users/:userId/suspend', async (request) => {
    const principal = await requireAdmin(request);
    const { userId } = request.params as { userId: string };
    const body = parse(suspendUserSchema, request.body);

    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!before) throw notFound('That user');

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          status: 'SUSPENDED',
          suspendedAt: new Date(),
          suspendedReason: body.reason,
        },
      }),
      // Suspension must take effect now, not when the access token expires.
      prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.USER_SUSPENDED,
      targetType: 'user',
      targetId: userId,
      previousValue: before,
      newValue: { status: 'SUSPENDED', reason: body.reason },
      ipAddress: clientIp(request) ?? null,
      userAgent: userAgent(request) ?? null,
    });

    return success({ suspended: true });
  });

  app.post('/admin/users/:userId/restore', async (request) => {
    const principal = await requireAdmin(request);
    const { userId } = request.params as { userId: string };

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.USER_RESTORED,
      targetType: 'user',
      targetId: userId,
      newValue: { status: 'ACTIVE' },
    });

    return success({ restored: true });
  });

  /* ------------------------------------------------------------- business */

  app.get('/admin/businesses', async (request) => {
    await requireAdmin(request);
    const query = parse(adminBusinessQuerySchema, request.query, 'filters');

    const rows = await prisma.business.findMany({
      where: {
        deletedAt: null,
        // Unclaimed OpenStreetMap listings live under /admin/listings; once
        // claimed they appear here like any other cafe awaiting approval.
        OR: [{ osmId: null }, { claimedAt: { not: null } }],
        ...(query.status !== 'ALL' ? { status: query.status } : {}),
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      include: {
        city: { select: { name: true } },
        area: { select: { name: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return success(
      items.map((business) => ({
        id: business.id,
        name: business.name,
        slug: business.slug,
        type: business.type,
        status: business.status,
        cityName: business.city.name,
        areaName: business.area?.name ?? null,
        rating: business.ratingCount > 0 ? business.ratingAverage : null,
        orderCount: business._count.orders,
        createdAt: business.createdAt.toISOString(),
      })),
      { nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null, hasMore },
    );
  });

  /** Onboard a cafe: creates the business and its owner account together. */
  app.post('/admin/businesses', async (request, reply) => {
    const principal = await requireAdmin(request);
    const body = parse(registerBusinessSchema, request.body);

    const area = await prisma.area.findUnique({
      where: { id: body.areaId },
      include: { city: true },
    });
    if (!area) throw notFound('That area');

    const slug =
      body.slug ??
      `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    const result = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          slug,
          name: body.name,
          type: body.type,
          status: 'PENDING_APPROVAL',
          description: body.description ?? null,
          addressLine: body.addressLine,
          areaId: area.id,
          cityId: area.cityId,
          latitude: body.coordinates.latitude,
          longitude: body.coordinates.longitude,
          phone: body.phone ?? null,
          timezone: area.city.timezone,
          // Seed a sensible week; the owner adjusts it from the dashboard.
          hours: {
            create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
              dayOfWeek,
              opensAt: 8 * 60,
              closesAt: 23 * 60,
              isClosed: false,
            })),
          },
        },
        select: { id: true },
      });

      const owner = await ensureOwner(tx, body.ownerEmail, body.ownerName);
      const temporaryPassword = owner.temporaryPassword;

      await tx.cafeStaff.create({
        data: { businessId: business.id, userId: owner.id, staffRole: 'OWNER' },
      });

      return { businessId: business.id, ownerId: owner.id, temporaryPassword };
    });

    return reply.code(201).send(success(result));
  });

  app.post('/admin/businesses/:businessId/approve', async (request) => {
    const principal = await requireAdmin(request);
    const { businessId } = request.params as { businessId: string };

    const before = await prisma.business.findUnique({
      where: { id: businessId },
      select: { status: true },
    });
    if (!before) throw notFound('That cafe');

    // An imported listing goes live only with an owner and a menu, and only
    // then starts taking orders (it was imported with ordering off).
    const { imported } = await assertListingReadyForApproval(prisma, businessId);

    await prisma.business.update({
      where: { id: businessId },
      data: {
        ...(imported ? { acceptingOrders: true } : {}),
        status: 'ACTIVE',
        approvedAt: new Date(),
        approvedById: principal.userId,
        rejectionNote: null,
      },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.BUSINESS_APPROVED,
      targetType: 'business',
      targetId: businessId,
      previousValue: before,
      newValue: { status: 'ACTIVE' },
    });

    return success({ approved: true });
  });

  app.post('/admin/businesses/:businessId/reject', async (request) => {
    const principal = await requireAdmin(request);
    const { businessId } = request.params as { businessId: string };
    const body = parse(rejectBusinessSchema, request.body);

    const before = await prisma.business.findUnique({
      where: { id: businessId },
      select: { status: true },
    });
    if (!before) throw notFound('That cafe');

    await prisma.business.update({
      where: { id: businessId },
      data: { status: 'REJECTED', rejectionNote: body.note },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.BUSINESS_REJECTED,
      targetType: 'business',
      targetId: businessId,
      previousValue: before,
      newValue: { status: 'REJECTED', note: body.note },
    });

    return success({ rejected: true });
  });

  app.post('/admin/businesses/:businessId/suspend', async (request) => {
    const principal = await requireAdmin(request);
    const { businessId } = request.params as { businessId: string };
    const body = parse(rejectBusinessSchema, request.body);

    const before = await prisma.business.findUnique({
      where: { id: businessId },
      select: { status: true },
    });
    if (!before) throw notFound('That cafe');

    await prisma.business.update({
      where: { id: businessId },
      data: { status: 'SUSPENDED', acceptingOrders: false, rejectionNote: body.note },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.BUSINESS_SUSPENDED,
      targetType: 'business',
      targetId: businessId,
      previousValue: before,
      newValue: { status: 'SUSPENDED', note: body.note },
    });

    return success({ suspended: true });
  });

  app.post('/admin/businesses/:businessId/reinstate', async (request) => {
    const principal = await requireAdmin(request);
    const { businessId } = request.params as { businessId: string };

    await prisma.business.update({
      where: { id: businessId },
      data: { status: 'ACTIVE', acceptingOrders: true, rejectionNote: null },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.BUSINESS_REINSTATED,
      targetType: 'business',
      targetId: businessId,
      newValue: { status: 'ACTIVE' },
    });

    return success({ reinstated: true });
  });

  /* --------------------------------------------------------------- orders */

  app.get('/admin/orders', async (request) => {
    await requireAdmin(request);
    const query = request.query as {
      q?: string;
      status?: string;
      businessId?: string;
      limit?: string;
      cursor?: string;
    };

    const limit = Math.min(Number(query.limit ?? 25) || 25, 100);

    const rows = await prisma.order.findMany({
      where: {
        ...(query.businessId ? { businessId: query.businessId } : {}),
        ...(query.status && query.status !== 'ALL'
          ? { status: query.status as Prisma.EnumOrderStatusFilter['equals'] }
          : {}),
        ...(query.q
          ? {
              OR: [
                { orderNumber: { contains: query.q.toUpperCase() } },
                { user: { email: { contains: query.q, mode: 'insensitive' } } },
                { user: { phone: { contains: query.q } } },
              ],
            }
          : {}),
      },
      include: {
        business: { select: { name: true } },
        user: { select: { profile: { select: { fullName: true } } } },
        payment: { select: { status: true, method: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return success(
      items.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.payment?.status ?? 'PENDING',
        paymentMethod: order.payment?.method ?? null,
        total: order.total,
        businessName: order.business.name,
        customerName: order.user.profile?.fullName ?? '',
        pickupAt: order.pickupAt.toISOString(),
        createdAt: order.createdAt.toISOString(),
      })),
      { nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null, hasMore },
    );
  });

  app.post('/admin/orders/:orderId/cancel', async (request) => {
    const principal = await requireAdmin(request);
    const { orderId } = request.params as { orderId: string };
    const body = parse(adminCancelOrderSchema, request.body);

    const order = await transitionOrder({
      orderId,
      to: 'CANCELLED_BY_ADMIN',
      actor: { userId: principal.userId, type: 'ADMIN', isAdmin: true },
      note: body.reason,
    });

    if (body.refund) {
      await refundOrder(orderId, null, body.reason).catch((error: unknown) => {
        // The cancellation stands even if the gateway refuses the refund; the
        // audit trail is what surfaces it for manual follow-up.
        console.error('[admin] refund after cancellation failed', error);
      });
    }

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.ORDER_CANCELLED,
      targetType: 'order',
      targetId: orderId,
      newValue: { reason: body.reason, refunded: body.refund },
    });

    return success(order);
  });

  app.post('/admin/orders/:orderId/refund', async (request) => {
    const principal = await requireAdmin(request);
    const { orderId } = request.params as { orderId: string };
    const body = parse(adminRefundOrderSchema, request.body);

    const result = await refundOrder(orderId, body.amount ?? null, body.reason);

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.ORDER_REFUNDED,
      targetType: 'order',
      targetId: orderId,
      newValue: { amount: result.refundedAmount, reason: body.reason },
    });

    return success(result);
  });

  /* -------------------------------------------------------------- loyalty */

  app.get('/admin/config', async (request) => {
    await requireAdmin(request);

    const [loyalty, referral, platform] = await Promise.all([
      getLoyaltyConfig(prisma),
      getReferralConfig(prisma),
      getPlatformConfig(prisma),
    ]);

    return success({ loyalty, referral, platform });
  });

  app.put('/admin/config/loyalty', async (request) => {
    const principal = await requireAdmin(request);
    const body = parse(loyaltyConfigSchema, request.body);
    const before = await getLoyaltyConfig(prisma);

    await writeSetting(prisma, ConfigKey.LOYALTY, body, principal.userId);

    const { previous, next } = diffFields(before, body);
    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.CONFIG_UPDATED,
      targetType: 'config',
      targetId: ConfigKey.LOYALTY,
      previousValue: previous,
      newValue: next,
    });

    return success(body);
  });

  app.put('/admin/config/referral', async (request) => {
    const principal = await requireAdmin(request);
    const body = parse(referralConfigSchema, request.body);
    const before = await getReferralConfig(prisma);

    await writeSetting(prisma, ConfigKey.REFERRAL, body, principal.userId);

    const { previous, next } = diffFields(before, body);
    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.CONFIG_UPDATED,
      targetType: 'config',
      targetId: ConfigKey.REFERRAL,
      previousValue: previous,
      newValue: next,
    });

    return success(body);
  });

  app.put('/admin/config/platform', async (request) => {
    const principal = await requireAdmin(request);
    const body = parse(platformConfigSchema, request.body);
    const before = await getPlatformConfig(prisma);

    await writeSetting(prisma, ConfigKey.PLATFORM, body, principal.userId);

    const { previous, next } = diffFields(before, body);
    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.CONFIG_UPDATED,
      targetType: 'config',
      targetId: ConfigKey.PLATFORM,
      previousValue: previous,
      newValue: next,
    });

    return success(body);
  });

  /** Manual points correction. Goes through the ledger like everything else. */
  app.post('/admin/points/adjust', async (request) => {
    const principal = await requireAdmin(request);
    const body = parse(adjustPointsSchema, request.body);

    const result = await prisma.$transaction((tx) =>
      applyPointsDelta(tx, {
        userId: body.userId,
        amount: body.amount,
        type: 'ADMIN_ADJUSTMENT',
        description: body.reason,
        referenceType: 'admin',
        referenceId: principal.userId,
      }),
    );

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.POINTS_ADJUSTED,
      targetType: 'user',
      targetId: body.userId,
      newValue: { amount: body.amount, reason: body.reason },
    });

    return success({ balance: result?.balanceAfter ?? null });
  });

  /* -------------------------------------------------------------- rewards */

  app.get('/admin/rewards', async (request) => {
    await requireAdmin(request);
    const rewards = await prisma.reward.findMany({ orderBy: { pointsRequired: 'asc' } });
    return success(rewards);
  });

  app.post('/admin/rewards', async (request, reply) => {
    const principal = await requireAdmin(request);
    const body = parse(rewardSchema, request.body);

    const reward = await prisma.reward.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        imageUrl: body.imageUrl ?? null,
        pointsRequired: body.pointsRequired,
        type: body.type,
        discountAmount: body.discountAmount ?? null,
        discountPercentage: body.discountPercentage ?? null,
        maxDiscountAmount: body.maxDiscountAmount ?? null,
        freeItemMenuItemIds: body.freeItemMenuItemIds,
        businessId: body.businessId ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        usageLimit: body.usageLimit ?? null,
        isActive: body.isActive,
      },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.REWARD_CREATED,
      targetType: 'reward',
      targetId: reward.id,
      newValue: body,
    });

    return reply.code(201).send(success(reward));
  });

  app.patch('/admin/rewards/:rewardId', async (request) => {
    const principal = await requireAdmin(request);
    const { rewardId } = request.params as { rewardId: string };
    const body = parse(rewardUpdateSchema, request.body);

    const before = await prisma.reward.findUnique({ where: { id: rewardId } });
    if (!before) throw notFound('That reward');

    const reward = await prisma.reward.update({
      where: { id: rewardId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.pointsRequired !== undefined ? { pointsRequired: body.pointsRequired } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.discountAmount !== undefined ? { discountAmount: body.discountAmount } : {}),
        ...(body.discountPercentage !== undefined
          ? { discountPercentage: body.discountPercentage }
          : {}),
        ...(body.maxDiscountAmount !== undefined
          ? { maxDiscountAmount: body.maxDiscountAmount }
          : {}),
        ...(body.freeItemMenuItemIds !== undefined
          ? { freeItemMenuItemIds: body.freeItemMenuItemIds }
          : {}),
        ...(body.businessId !== undefined ? { businessId: body.businessId } : {}),
        ...(body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
          : {}),
        ...(body.usageLimit !== undefined ? { usageLimit: body.usageLimit } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.REWARD_UPDATED,
      targetType: 'reward',
      targetId: rewardId,
      previousValue: { ...before },
      newValue: body,
    });

    return success(reward);
  });

  /* ----------------------------------------------------------- promotions */

  app.get('/admin/promotions', async (request) => {
    await requireAdmin(request);
    const promotions = await prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } });
    return success(promotions);
  });

  app.post('/admin/promotions', async (request, reply) => {
    const principal = await requireAdmin(request);
    const body = parse(promotionSchema, request.body);

    const promotion = await prisma.promotion.create({
      data: {
        code: body.code,
        description: body.description ?? null,
        type: body.type,
        scope: body.scope,
        value: body.value,
        maxDiscountAmount: body.maxDiscountAmount ?? null,
        minimumOrderTotal: body.minimumOrderTotal,
        businessId: body.businessId ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        usageLimit: body.usageLimit ?? null,
        perUserLimit: body.perUserLimit ?? null,
        firstOrderOnly: body.firstOrderOnly,
        fundedBy: body.fundedBy,
        isActive: body.isActive,
      },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.PROMOTION_CREATED,
      targetType: 'promotion',
      targetId: promotion.id,
      newValue: body,
    });

    return reply.code(201).send(success(promotion));
  });

  app.patch('/admin/promotions/:promotionId', async (request) => {
    const principal = await requireAdmin(request);
    const { promotionId } = request.params as { promotionId: string };
    const body = parse(promotionUpdateSchema, request.body);

    const promotion = await prisma.promotion.update({
      where: { id: promotionId },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.maxDiscountAmount !== undefined
          ? { maxDiscountAmount: body.maxDiscountAmount }
          : {}),
        ...(body.minimumOrderTotal !== undefined
          ? { minimumOrderTotal: body.minimumOrderTotal }
          : {}),
        ...(body.startsAt !== undefined
          ? { startsAt: body.startsAt ? new Date(body.startsAt) : null }
          : {}),
        ...(body.endsAt !== undefined
          ? { endsAt: body.endsAt ? new Date(body.endsAt) : null }
          : {}),
        ...(body.usageLimit !== undefined ? { usageLimit: body.usageLimit } : {}),
        ...(body.perUserLimit !== undefined ? { perUserLimit: body.perUserLimit } : {}),
        ...(body.firstOrderOnly !== undefined ? { firstOrderOnly: body.firstOrderOnly } : {}),
        ...(body.fundedBy !== undefined ? { fundedBy: body.fundedBy } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.PROMOTION_UPDATED,
      targetType: 'promotion',
      targetId: promotionId,
      newValue: body,
    });

    return success(promotion);
  });

  /* ------------------------------------------------------------ geography */

  app.post('/admin/cities', async (request, reply) => {
    await requireAdmin(request);
    const body = parse(createCitySchema, request.body);
    const city = await prisma.city.create({ data: body });
    return reply.code(201).send(success(city));
  });

  app.post('/admin/areas', async (request, reply) => {
    await requireAdmin(request);
    const body = parse(createAreaSchema, request.body);
    const area = await prisma.area.create({ data: body });
    return reply.code(201).send(success(area));
  });

  /* ------------------------------------------------------------ analytics */

  app.get('/admin/analytics', async (request) => {
    await requireAdmin(request);
    const query = parse(analyticsRangeSchema, request.query, 'range');
    const range = resolveRange(query.preset, query.from, query.to);
    return success(await getAdminAnalytics(range));
  });

  app.get('/admin/audit-logs', async (request) => {
    await requireAdmin(request);
    const query = request.query as { targetType?: string; targetId?: string; limit?: string };
    const limit = Math.min(Number(query.limit ?? 50) || 50, 200);

    const logs = await prisma.auditLog.findMany({
      where: {
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
      },
      include: { actor: { select: { email: true, profile: { select: { fullName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return success(
      logs.map((log) => ({
        id: log.id,
        action: log.action,
        actorName: log.actor?.profile?.fullName ?? log.actor?.email ?? 'System',
        targetType: log.targetType,
        targetId: log.targetId,
        previousValue: log.previousValue,
        newValue: log.newValue,
        createdAt: log.createdAt.toISOString(),
      })),
    );
  });
}

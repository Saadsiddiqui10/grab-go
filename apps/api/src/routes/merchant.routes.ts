import type { FastifyInstance } from 'fastify';
import {
  merchantRewardSchema,
  merchantRewardUpdateSchema,
  analyticsRangeSchema,
  createMenuItemSchema,
  holidaySchema,
  inviteStaffSchema,
  menuCategorySchema,
  merchantAcceptOrderSchema,
  merchantOrdersQuerySchema,
  merchantRejectOrderSchema,
  merchantUpdatePrepTimeSchema,
  reorderItemsSchema,
  setItemAvailabilitySchema,
  updateBusinessProfileSchema,
  updateBusinessSettingsSchema,
  updateMenuItemSchema,
  updateOpeningHoursSchema,
  updateStaffSchema,
  verifyPickupSchema,
  verifyPickupTokenSchema,
  posConnectionSchema,
} from '@grabgo/validation';
import { prisma } from '../db';
import {
  configurePos,
  getPosStatus,
  retryPosJobs,
  rotatePosSecret,
  testPosConnection,
} from '../services/pos/pos.service';
import { getEnv } from '../env';
import { parse } from '../lib/validate';
import { HttpError, forbidden, notFound, success } from '../lib/http-error';
import { clientIp, requireAuth, requireStaffOf } from '../lib/auth-context';
import { verifyPickupToken } from '../lib/tokens';
import { hashPassword, randomToken } from '../lib/crypto';
import {
  computeAvailability,
  getMenu,
  loadBusiness,
} from '../services/business.service';
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  reorderCategories,
  reorderItems,
  setItemAvailability,
  updateCategory,
  updateMenuItem,
} from '../services/menu.service';
import {
  getOrderForViewer,
  listBusinessOrders,
  transitionOrder,
  verifyPickup,
  type OrderActor,
} from '../services/order.service';
import { getMerchantAnalytics, resolveRange } from '../services/analytics.service';
import { AuditAction, recordAudit } from '../services/audit.service';
import { createCafeReward, listCafeRewards, updateCafeReward } from '../services/loyalty.service';
import { emitBusinessAvailability } from '../realtime';
import { toBusinessDetail } from '../mappers';

/**
 * Merchant dashboard API.
 *
 * Every route is scoped to one cafe by path, and `requireStaffOf` is the first
 * line of each handler — so an authenticated merchant cannot reach another
 * cafe's orders or menu by changing an id.
 */
export async function registerMerchantRoutes(app: FastifyInstance): Promise<void> {
  const actorFor = (
    principal: Awaited<ReturnType<typeof requireAuth>>,
  ): OrderActor => ({
    userId: principal.userId,
    type: principal.isAdmin ? 'ADMIN' : 'MERCHANT',
    businesses: principal.businesses,
    isAdmin: principal.isAdmin,
  });

  /** Cafes this account staffs. The dashboard's cafe picker. */
  app.get('/merchant/businesses', async (request) => {
    const principal = await requireAuth(request);

    const staff = await prisma.cafeStaff.findMany({
      where: { userId: principal.userId, isActive: true },
      include: {
        business: {
          include: { area: true, city: true, hours: true, holidays: true },
        },
      },
    });

    const businesses = await Promise.all(
      staff.map(async (row) => {
        const activeCount = await prisma.order.count({
          where: { businessId: row.businessId, status: { in: ['ACCEPTED', 'PREPARING'] } },
        });
        const availability = computeAvailability(row.business, activeCount, new Date());

        return {
          ...toBusinessDetail(row.business, {
            distanceMeters: null,
            isOpenNow: availability.isOpenNow,
            busyUntilMinutes: availability.busyUntilMinutes,
            isFavourite: false,
            popularItems: [],
            prepTimeMinutes: availability.effectiveLeadMinutes,
          }),
          staffRole: row.staffRole,
        };
      }),
    );

    return success(businesses);
  });

  /* ---------------------------------------------------------- live orders */

  app.get('/merchant/:businessId/orders', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const query = parse(merchantOrdersQuerySchema, request.query, 'filters');

    const result = await listBusinessOrders(businessId, {
      status: query.status,
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      cursor: query.cursor ?? null,
      limit: query.limit,
    });

    return success(result.items, {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  });

  app.get('/merchant/:businessId/orders/:orderId', async (request) => {
    const { businessId, orderId } = request.params as {
      businessId: string;
      orderId: string;
    };
    const principal = await requireStaffOf(request, businessId);
    return success(await getOrderForViewer(orderId, actorFor(principal)));
  });

  app.post('/merchant/:businessId/orders/:orderId/accept', async (request) => {
    const { businessId, orderId } = request.params as {
      businessId: string;
      orderId: string;
    };
    const principal = await requireStaffOf(request, businessId);
    const body = parse(merchantAcceptOrderSchema, request.body ?? {});

    return success(
      await transitionOrder({
        orderId,
        to: 'ACCEPTED',
        actor: actorFor(principal),
        ...(body.prepTimeMinutes ? { prepTimeMinutes: body.prepTimeMinutes } : {}),
      }),
    );
  });

  app.post('/merchant/:businessId/orders/:orderId/reject', async (request) => {
    const { businessId, orderId } = request.params as {
      businessId: string;
      orderId: string;
    };
    const principal = await requireStaffOf(request, businessId);
    // A reason is mandatory: the customer is owed an explanation, and the
    // state machine refuses the transition without one.
    const body = parse(merchantRejectOrderSchema, request.body);

    return success(
      await transitionOrder({
        orderId,
        to: 'CANCELLED_BY_CAFE',
        actor: actorFor(principal),
        reason: body.reason,
        note: body.note ?? null,
      }),
    );
  });

  app.post('/merchant/:businessId/orders/:orderId/preparing', async (request) => {
    const { businessId, orderId } = request.params as {
      businessId: string;
      orderId: string;
    };
    const principal = await requireStaffOf(request, businessId);

    return success(
      await transitionOrder({ orderId, to: 'PREPARING', actor: actorFor(principal) }),
    );
  });

  app.post('/merchant/:businessId/orders/:orderId/ready', async (request) => {
    const { businessId, orderId } = request.params as {
      businessId: string;
      orderId: string;
    };
    const principal = await requireStaffOf(request, businessId);

    return success(
      await transitionOrder({ orderId, to: 'READY', actor: actorFor(principal) }),
    );
  });

  app.patch('/merchant/:businessId/orders/:orderId/prep-time', async (request) => {
    const { businessId, orderId } = request.params as {
      businessId: string;
      orderId: string;
    };
    await requireStaffOf(request, businessId);
    const body = parse(merchantUpdatePrepTimeSchema, request.body);

    const order = await prisma.order.findFirst({
      where: { id: orderId, businessId },
      select: { id: true, acceptedAt: true },
    });
    if (!order) throw notFound('That order');

    await prisma.order.update({
      where: { id: orderId },
      data: {
        prepTimeMinutes: body.prepTimeMinutes,
        estimatedReadyAt: new Date(Date.now() + body.prepTimeMinutes * 60_000),
      },
    });

    return success({ updated: true });
  });

  /**
   * Hand the order over.
   *
   * The counter either types the code or scans the QR; both land here, and both
   * go through the same verification before the order can move to PICKED_UP.
   */
  app.post('/merchant/:businessId/orders/:orderId/pickup', async (request) => {
    const { businessId, orderId } = request.params as {
      businessId: string;
      orderId: string;
    };
    const principal = await requireStaffOf(request, businessId);
    const body = parse(verifyPickupSchema, request.body);

    return success(
      await verifyPickup({
        orderId,
        submittedCode: body.code,
        actor: actorFor(principal),
        method: 'CODE',
        ipAddress: clientIp(request) ?? null,
      }),
    );
  });

  app.post('/merchant/:businessId/orders/pickup-scan', async (request) => {
    const { businessId } = request.params as { businessId: string };
    const principal = await requireStaffOf(request, businessId);
    const body = parse(verifyPickupTokenSchema, request.body);

    const claims = await verifyPickupToken(body.token, getEnv().PICKUP_TOKEN_SECRET);

    // The token proves the code, but the order must still belong to this cafe.
    const order = await prisma.order.findFirst({
      where: { id: claims.sub, businessId },
      select: { id: true },
    });
    if (!order) throw forbidden('That order is not for this cafe.');

    return success(
      await verifyPickup({
        orderId: claims.sub,
        submittedCode: claims.cod,
        actor: actorFor(principal),
        method: 'QR',
        ipAddress: clientIp(request) ?? null,
      }),
    );
  });

  app.post('/merchant/:businessId/orders/:orderId/complete', async (request) => {
    const { businessId, orderId } = request.params as {
      businessId: string;
      orderId: string;
    };
    const principal = await requireStaffOf(request, businessId);

    return success(
      await transitionOrder({ orderId, to: 'COMPLETED', actor: actorFor(principal) }),
    );
  });

  /* ----------------------------------------------------------------- menu */

  /* ------------------------------------------------------------- rewards */

  /** The cafe's own loyalty rewards, active and retired. */
  app.get('/merchant/:businessId/rewards', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    return success(await listCafeRewards(prisma, businessId));
  });

  app.post('/merchant/:businessId/rewards', async (request, reply) => {
    const { businessId } = request.params as { businessId: string };
    const principal = await requireStaffOf(request, businessId);
    const body = parse(merchantRewardSchema, request.body);
    const reward = await createCafeReward(businessId, body);
    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.REWARD_CREATED,
      targetType: 'reward',
      targetId: reward.id,
      newValue: { businessId, name: reward.name, pointsRequired: reward.pointsRequired },
    });
    return reply.code(201).send(success(reward));
  });

  /** Edit or retire a reward (`isActive: false`). Rewards are never deleted: issued codes reference them. */
  app.patch('/merchant/:businessId/rewards/:rewardId', async (request) => {
    const { businessId, rewardId } = request.params as { businessId: string; rewardId: string };
    const principal = await requireStaffOf(request, businessId);
    const body = parse(merchantRewardUpdateSchema, request.body);
    const reward = await updateCafeReward(businessId, rewardId, body);
    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.REWARD_UPDATED,
      targetType: 'reward',
      targetId: reward.id,
      newValue: body,
    });
    return success(reward);
  });

  app.get('/merchant/:businessId/menu', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    // Merchants see everything, including hidden and sold-out items.
    return success(await getMenu(prisma, businessId, { includeUnavailable: true }));
  });

  app.post('/merchant/:businessId/categories', async (request, reply) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const body = parse(menuCategorySchema, request.body);
    return reply.code(201).send(success(await createCategory(businessId, body)));
  });

  app.patch('/merchant/:businessId/categories/:categoryId', async (request) => {
    const { businessId, categoryId } = request.params as {
      businessId: string;
      categoryId: string;
    };
    await requireStaffOf(request, businessId);
    const body = parse(menuCategorySchema.partial(), request.body);
    await updateCategory(businessId, categoryId, body);
    return success({ updated: true });
  });

  app.delete('/merchant/:businessId/categories/:categoryId', async (request) => {
    const { businessId, categoryId } = request.params as {
      businessId: string;
      categoryId: string;
    };
    await requireStaffOf(request, businessId);
    await deleteCategory(businessId, categoryId);
    return success({ deleted: true });
  });

  app.post('/merchant/:businessId/categories/reorder', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const body = parse(reorderItemsSchema, request.body);
    await reorderCategories(businessId, body.ids);
    return success({ reordered: true });
  });

  app.post('/merchant/:businessId/items', async (request, reply) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const body = parse(createMenuItemSchema, request.body);
    return reply.code(201).send(success(await createMenuItem(businessId, body)));
  });

  app.patch('/merchant/:businessId/items/:itemId', async (request) => {
    const { businessId, itemId } = request.params as {
      businessId: string;
      itemId: string;
    };
    await requireStaffOf(request, businessId);
    const body = parse(updateMenuItemSchema, request.body);
    return success(await updateMenuItem(businessId, itemId, body));
  });

  /** The mid-rush "we're out of oat milk" control. */
  app.patch('/merchant/:businessId/items/:itemId/availability', async (request) => {
    const { businessId, itemId } = request.params as {
      businessId: string;
      itemId: string;
    };
    await requireStaffOf(request, businessId);
    const body = parse(setItemAvailabilitySchema, request.body);
    await setItemAvailability(businessId, itemId, body);
    return success({ updated: true });
  });

  app.delete('/merchant/:businessId/items/:itemId', async (request) => {
    const { businessId, itemId } = request.params as {
      businessId: string;
      itemId: string;
    };
    await requireStaffOf(request, businessId);
    await deleteMenuItem(businessId, itemId);
    return success({ deleted: true });
  });

  app.post('/merchant/:businessId/items/reorder', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const body = parse(reorderItemsSchema, request.body);
    await reorderItems(businessId, body.ids);
    return success({ reordered: true });
  });

  /* ------------------------------------------------------------------ POS */

  app.get('/merchant/:businessId/pos', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    return success(await getPosStatus(businessId));
  });

  app.put('/merchant/:businessId/pos', async (request) => {
    const { businessId } = request.params as { businessId: string };
    const principal = await requireStaffOf(request, businessId);
    await assertManager(principal.userId, businessId, principal.isAdmin);
    const body = parse(posConnectionSchema, request.body);

    const result = await configurePos(businessId, {
      provider: body.provider,
      endpointUrl: body.endpointUrl ?? null,
      isEnabled: body.provider !== 'NONE' && body.isEnabled,
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.POS_CONFIGURED,
      targetType: 'business',
      targetId: businessId,
      // Never the secret.
      newValue: { provider: body.provider, endpointUrl: body.endpointUrl ?? null, isEnabled: body.isEnabled },
    });

    return success({ ...(await getPosStatus(businessId)), secret: result.secret });
  });

  app.post('/merchant/:businessId/pos/rotate-secret', async (request) => {
    const { businessId } = request.params as { businessId: string };
    const principal = await requireStaffOf(request, businessId);
    await assertManager(principal.userId, businessId, principal.isAdmin);
    const result = await rotatePosSecret(businessId);

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.POS_SECRET_ROTATED,
      targetType: 'business',
      targetId: businessId,
    });

    return success(result);
  });

  app.post('/merchant/:businessId/pos/test', async (request) => {
    const { businessId } = request.params as { businessId: string };
    const principal = await requireStaffOf(request, businessId);
    await assertManager(principal.userId, businessId, principal.isAdmin);
    return success(await testPosConnection(businessId));
  });

  // Any staff member can retry: it is the fix for "the POS was down".
  app.post('/merchant/:businessId/pos/retry', async (request) => {
    const { businessId } = request.params as { businessId: string };
    const principal = await requireStaffOf(request, businessId);
    const body = (request.body ?? {}) as { jobId?: unknown };
    const jobId = typeof body.jobId === 'string' ? body.jobId : undefined;
    const result = await retryPosJobs(businessId, jobId);

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.POS_RETRIED,
      targetType: 'business',
      targetId: businessId,
      newValue: { jobId: jobId ?? 'all', retried: result.retried },
    });

    return success({ ...result, status: await getPosStatus(businessId) });
  });

  /* ------------------------------------------------------------- settings */

  app.patch('/merchant/:businessId/profile', async (request) => {
    const { businessId } = request.params as { businessId: string };
    const principal = await requireStaffOf(request, businessId);
    const body = parse(updateBusinessProfileSchema, request.body);

    const updated = await prisma.business.update({
      where: { id: businessId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        ...(body.coverImageUrl !== undefined ? { coverImageUrl: body.coverImageUrl } : {}),
        ...(body.addressLine !== undefined ? { addressLine: body.addressLine } : {}),
        ...(body.areaId !== undefined ? { areaId: body.areaId } : {}),
        ...(body.coordinates
          ? { latitude: body.coordinates.latitude, longitude: body.coordinates.longitude }
          : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.priceTier !== undefined ? { priceTier: body.priceTier } : {}),
      },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      actorType: 'MERCHANT',
      action: AuditAction.BUSINESS_UPDATED,
      targetType: 'business',
      targetId: businessId,
      newValue: body,
    });

    return success({ id: updated.id, updated: true });
  });

  /**
   * Operational switches: pause orders, change the prep estimate, cap concurrency.
   *
   * Flipping `acceptingOrders` pushes straight to any open customer sessions, so
   * a cafe that pauses stops receiving orders immediately rather than at the next
   * page load.
   */
  app.patch('/merchant/:businessId/settings', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const body = parse(updateBusinessSettingsSchema, request.body);

    const updated = await prisma.business.update({
      where: { id: businessId },
      data: {
        ...(body.acceptingOrders !== undefined
          ? { acceptingOrders: body.acceptingOrders }
          : {}),
        ...(body.temporarilyClosed !== undefined
          ? { temporarilyClosed: body.temporarilyClosed }
          : {}),
        ...(body.prepTimeMinutes !== undefined
          ? { prepTimeMinutes: body.prepTimeMinutes }
          : {}),
        ...(body.minLeadTimeMinutes !== undefined
          ? { minLeadTimeMinutes: body.minLeadTimeMinutes }
          : {}),
        ...(body.maxScheduleAheadMinutes !== undefined
          ? { maxScheduleAheadMinutes: body.maxScheduleAheadMinutes }
          : {}),
        ...(body.maxConcurrentOrders !== undefined
          ? { maxConcurrentOrders: body.maxConcurrentOrders }
          : {}),
        ...(body.maxOrdersPerSlot !== undefined
          ? { maxOrdersPerSlot: body.maxOrdersPerSlot }
          : {}),
        ...(body.minimumOrderTotal !== undefined
          ? { minimumOrderTotal: body.minimumOrderTotal }
          : {}),
        ...(body.loyaltyEnabled !== undefined ? { loyaltyEnabled: body.loyaltyEnabled } : {}),
      },
      include: { area: true, city: true, hours: true, holidays: true },
    });

    const activeCount = await prisma.order.count({
      where: { businessId, status: { in: ['ACCEPTED', 'PREPARING'] } },
    });
    const availability = computeAvailability(updated, activeCount, new Date());

    emitBusinessAvailability({
      businessId,
      acceptingOrders: updated.acceptingOrders && !updated.temporarilyClosed,
      isOpenNow: availability.isOpenNow,
      busyUntilMinutes: availability.busyUntilMinutes,
    });

    return success({ updated: true });
  });

  app.put('/merchant/:businessId/hours', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const body = parse(updateOpeningHoursSchema, request.body);

    await prisma.$transaction(
      body.hours.map((hour) =>
        prisma.businessHour.upsert({
          where: { businessId_dayOfWeek: { businessId, dayOfWeek: hour.dayOfWeek } },
          create: {
            businessId,
            dayOfWeek: hour.dayOfWeek,
            opensAt: hour.isClosed ? null : hour.opensAt,
            closesAt: hour.isClosed ? null : hour.closesAt,
            isClosed: hour.isClosed,
          },
          update: {
            opensAt: hour.isClosed ? null : hour.opensAt,
            closesAt: hour.isClosed ? null : hour.closesAt,
            isClosed: hour.isClosed,
          },
        }),
      ),
    );

    const business = await loadBusiness(prisma, businessId);
    return success(
      business.hours.map((hour) => ({
        dayOfWeek: hour.dayOfWeek,
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
        isClosed: hour.isClosed,
      })),
    );
  });

  app.post('/merchant/:businessId/holidays', async (request, reply) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const body = parse(holidaySchema, request.body);

    const holiday = await prisma.businessHoliday.upsert({
      where: { businessId_date: { businessId, date: body.date } },
      create: {
        businessId,
        date: body.date,
        name: body.name ?? null,
        isClosed: body.isClosed,
        opensAt: body.opensAt ?? null,
        closesAt: body.closesAt ?? null,
      },
      update: {
        name: body.name ?? null,
        isClosed: body.isClosed,
        opensAt: body.opensAt ?? null,
        closesAt: body.closesAt ?? null,
      },
    });

    return reply.code(201).send(success({ id: holiday.id }));
  });

  app.delete('/merchant/:businessId/holidays/:holidayId', async (request) => {
    const { businessId, holidayId } = request.params as {
      businessId: string;
      holidayId: string;
    };
    await requireStaffOf(request, businessId);
    await prisma.businessHoliday.deleteMany({ where: { id: holidayId, businessId } });
    return success({ deleted: true });
  });

  /* ---------------------------------------------------------------- staff */

  app.get('/merchant/:businessId/staff', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);

    const staff = await prisma.cafeStaff.findMany({
      where: { businessId },
      include: {
        user: { select: { id: true, email: true, phone: true, profile: true } },
      },
      orderBy: { invitedAt: 'asc' },
    });

    return success(
      staff.map((row) => ({
        id: row.id,
        userId: row.userId,
        fullName: row.user.profile?.fullName ?? '',
        email: row.user.email,
        phone: row.user.phone,
        staffRole: row.staffRole,
        isActive: row.isActive,
        createdAt: row.invitedAt.toISOString(),
      })),
    );
  });

  app.post('/merchant/:businessId/staff', async (request, reply) => {
    const { businessId } = request.params as { businessId: string };
    const principal = await requireStaffOf(request, businessId);
    await assertManager(principal.userId, businessId, principal.isAdmin);

    const body = parse(inviteStaffSchema, request.body);

    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: { email: body.email },
        select: { id: true },
      });

      let temporaryPassword: string | null = null;

      if (!user) {
        // New staff get a provisional password to hand over out of band; they
        // are expected to reset it on first sign-in.
        temporaryPassword = randomToken(9);
        user = await tx.user.create({
          data: {
            email: body.email,
            passwordHash: await hashPassword(temporaryPassword),
            role: 'MERCHANT',
            referralCode: `STAFF${randomToken(5).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)}`,
            profile: { create: { fullName: body.fullName } },
          },
          select: { id: true },
        });
      } else {
        await tx.user.update({
          where: { id: user.id },
          data: { role: 'MERCHANT' },
        });
      }

      const staff = await tx.cafeStaff.upsert({
        where: { businessId_userId: { businessId, userId: user.id } },
        create: { businessId, userId: user.id, staffRole: body.staffRole },
        update: { staffRole: body.staffRole, isActive: true },
      });

      return { staffId: staff.id, userId: user.id, temporaryPassword };
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      actorType: 'MERCHANT',
      action: AuditAction.STAFF_INVITED,
      targetType: 'cafe_staff',
      targetId: result.staffId,
      newValue: { email: body.email, staffRole: body.staffRole },
    });

    return reply.code(201).send(success(result));
  });

  app.patch('/merchant/:businessId/staff/:staffId', async (request) => {
    const { businessId, staffId } = request.params as {
      businessId: string;
      staffId: string;
    };
    const principal = await requireStaffOf(request, businessId);
    await assertManager(principal.userId, businessId, principal.isAdmin);

    const body = parse(updateStaffSchema, request.body);

    const staff = await prisma.cafeStaff.findFirst({
      where: { id: staffId, businessId },
      select: { id: true, userId: true, staffRole: true },
    });
    if (!staff) throw notFound('That staff member');

    // A cafe must keep at least one active owner, or nobody can administer it.
    if (staff.staffRole === 'OWNER' && (body.staffRole !== 'OWNER' || body.isActive === false)) {
      const owners = await prisma.cafeStaff.count({
        where: { businessId, staffRole: 'OWNER', isActive: true },
      });
      if (owners <= 1) {
        throw new HttpError('CONFLICT', 'A cafe needs at least one active owner.');
      }
    }

    await prisma.cafeStaff.update({
      where: { id: staffId },
      data: {
        ...(body.staffRole !== undefined ? { staffRole: body.staffRole } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      actorType: 'MERCHANT',
      action: AuditAction.STAFF_UPDATED,
      targetType: 'cafe_staff',
      targetId: staffId,
      newValue: body,
    });

    return success({ updated: true });
  });

  /* ------------------------------------------------------------ analytics */

  app.get('/merchant/:businessId/analytics', async (request) => {
    const { businessId } = request.params as { businessId: string };
    await requireStaffOf(request, businessId);
    const query = parse(analyticsRangeSchema, request.query, 'range');

    const range = resolveRange(query.preset, query.from, query.to);
    return success(await getMerchantAnalytics(businessId, range));
  });
}

async function assertManager(
  userId: string,
  businessId: string,
  isAdmin: boolean,
): Promise<void> {
  if (isAdmin) return;

  const staff = await prisma.cafeStaff.findUnique({
    where: { businessId_userId: { businessId, userId } },
    select: { staffRole: true, isActive: true },
  });

  if (!staff?.isActive || staff.staffRole === 'STAFF') {
    throw forbidden('You need a manager account to do that.');
  }
}

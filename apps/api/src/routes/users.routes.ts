import type { FastifyInstance } from 'fastify';
import {
  analyticsBatchSchema,
  listPointsQuerySchema,
  notificationPreferencesSchema,
  redeemRewardSchema,
  savedAddressSchema,
  setFavouriteSchema,
  updateProfileSchema,
} from '@grabgo/validation';
import { prisma } from '../db';
import { parse } from '../lib/validate';
import { success } from '../lib/http-error';
import { optionalAuth, requireAuth } from '../lib/auth-context';
import {
  addFavourite,
  deleteAddress,
  getNotificationPreferences,
  listAddresses,
  listNotifications,
  markNotificationsRead,
  removeFavourite,
  saveAddress,
  updateNotificationPreferences,
  updateProfile,
} from '../services/user.service';
import {
  getPointsSummary,
  listPointsTransactions,
  listRedemptions,
  listRewards,
  redeemReward,
} from '../services/loyalty.service';
import { getReferralProgress } from '../services/referral.service';
import { recordEvents } from '../services/analytics.service';

/**
 * The signed-in customer: profile, favourites, saved locations, points, rewards,
 * referrals and notification preferences.
 */
export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.patch('/users/me', async (request) => {
    const principal = await requireAuth(request);
    const body = parse(updateProfileSchema, request.body);

    const profile = await updateProfile(principal.userId, {
      ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
      ...(body.cityId !== undefined ? { cityId: body.cityId } : {}),
    });

    return success(profile);
  });

  /* ------------------------------------------------------------ favourites */

  app.get('/users/me/favourites', async (request) => {
    const principal = await requireAuth(request);

    const favourites = await prisma.favourite.findMany({
      where: { userId: principal.userId },
      orderBy: { createdAt: 'desc' },
      select: { businessId: true },
    });

    return success(favourites.map((row) => row.businessId));
  });

  app.post('/users/me/favourites', async (request, reply) => {
    const principal = await requireAuth(request);
    const body = parse(setFavouriteSchema, request.body);
    await addFavourite(principal.userId, body.businessId);
    return reply.code(201).send(success({ favourited: true }));
  });

  app.delete('/users/me/favourites/:businessId', async (request) => {
    const principal = await requireAuth(request);
    const { businessId } = request.params as { businessId: string };
    await removeFavourite(principal.userId, businessId);
    return success({ favourited: false });
  });

  /* --------------------------------------------------------------- places */

  app.get('/users/me/addresses', async (request) => {
    const principal = await requireAuth(request);
    return success(await listAddresses(principal.userId));
  });

  app.post('/users/me/addresses', async (request, reply) => {
    const principal = await requireAuth(request);
    const body = parse(savedAddressSchema, request.body);

    const address = await saveAddress(principal.userId, {
      label: body.label,
      addressLine: body.addressLine,
      areaId: body.areaId ?? null,
      cityId: body.cityId,
      coordinates: body.coordinates ?? null,
      isDefault: body.isDefault,
    });

    return reply.code(201).send(success(address));
  });

  app.delete('/users/me/addresses/:addressId', async (request) => {
    const principal = await requireAuth(request);
    const { addressId } = request.params as { addressId: string };
    await deleteAddress(principal.userId, addressId);
    return success({ deleted: true });
  });

  /* --------------------------------------------------------------- points */

  app.get('/users/me/points', async (request) => {
    const principal = await requireAuth(request);
    return success(await getPointsSummary(prisma, principal.userId));
  });

  app.get('/users/me/points/transactions', async (request) => {
    const principal = await requireAuth(request);
    const query = parse(listPointsQuerySchema, request.query, 'filters');

    const result = await listPointsTransactions(prisma, principal.userId, {
      cursor: query.cursor ?? null,
      limit: query.limit,
    });

    return success(result.items, {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  });

  /* -------------------------------------------------------------- rewards */

  app.get('/rewards', async (request) => {
    // Browsable signed out, so the rewards tab is not an empty login wall.
    const principal = await optionalAuth(request);
    const query = request.query as { businessId?: string };
    return success(
      await listRewards(prisma, principal?.userId ?? null, query.businessId ?? null),
    );
  });

  app.get('/users/me/rewards', async (request) => {
    const principal = await requireAuth(request);
    return success(await listRedemptions(prisma, principal.userId));
  });

  app.post('/rewards/:rewardId/redeem', async (request, reply) => {
    const principal = await requireAuth(request);
    const { rewardId } = request.params as { rewardId: string };
    const body = parse(redeemRewardSchema, request.body ?? {});

    const redemption = await redeemReward(
      principal.userId,
      rewardId,
      body.businessId ?? null,
    );

    return reply.code(201).send(success(redemption));
  });

  /* ------------------------------------------------------------ referrals */

  app.get('/users/me/referrals', async (request) => {
    const principal = await requireAuth(request);
    return success(await getReferralProgress(prisma, principal.userId));
  });

  /* -------------------------------------------------------- notifications */

  app.get('/users/me/notifications', async (request) => {
    const principal = await requireAuth(request);
    return success(await listNotifications(principal.userId));
  });

  app.post('/users/me/notifications/read', async (request) => {
    const principal = await requireAuth(request);
    await markNotificationsRead(principal.userId);
    return success({ read: true });
  });

  app.get('/users/me/notification-preferences', async (request) => {
    const principal = await requireAuth(request);
    return success(await getNotificationPreferences(principal.userId));
  });

  app.put('/users/me/notification-preferences', async (request) => {
    const principal = await requireAuth(request);
    const body = parse(notificationPreferencesSchema, request.body);

    return success(
      await updateNotificationPreferences(principal.userId, {
        ...(body.push ? { push: body.push } : {}),
        ...(body.email ? { email: body.email } : {}),
        ...(body.sms ? { sms: body.sms } : {}),
      }),
    );
  });

  /* ------------------------------------------------------------ analytics */

  /** Accepts events from any client, signed in or not. Never fails the caller. */
  app.post('/analytics/events', async (request, reply) => {
    const principal = await optionalAuth(request);
    const body = parse(analyticsBatchSchema, request.body);
    const sessionId = request.headers['x-session-id'];

    await recordEvents(body, {
      userId: principal?.userId ?? null,
      sessionId: typeof sessionId === 'string' ? sessionId : null,
    });

    return reply.code(202).send(success({ accepted: body.events.length }));
  });
}

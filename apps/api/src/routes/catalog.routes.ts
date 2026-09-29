import type { FastifyInstance } from 'fastify';
import { discoverQuerySchema, searchMenuQuerySchema } from '@grabgo/validation';
import { prisma } from '../db';
import { parse } from '../lib/validate';
import { success } from '../lib/http-error';
import { optionalAuth } from '../lib/auth-context';
import {
  discoverBusinesses,
  getBusinessDetail,
  getMenu,
  getPickupSlots,
  loadBusiness,
} from '../services/business.service';
import { searchMenuItems } from '../services/menu.service';
import { getPublicConfig } from '../services/settings.service';
import { toReview } from '../mappers';

/**
 * Public catalogue: cities, discovery, cafe profiles, menus, pickup slots.
 *
 * Every route here works signed out. Authentication only ever *adds* something —
 * favourite flags, personalised ordering — so a customer who has not signed in,
 * or who declined location, still gets a complete browsing experience.
 */
export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/config', async () => success(await getPublicConfig(prisma)));

  app.get('/cities', async () => {
    const cities = await prisma.city.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        areas: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    return success(
      cities.map((city) => ({
        id: city.id,
        name: city.name,
        slug: city.slug,
        countryCode: city.countryCode,
        timezone: city.timezone,
        isActive: city.isActive,
        areas: city.areas.map((area) => ({
          id: area.id,
          cityId: area.cityId,
          name: area.name,
          slug: area.slug,
          latitude: area.latitude,
          longitude: area.longitude,
          isActive: area.isActive,
        })),
      })),
    );
  });

  app.get('/cafes', async (request) => {
    const query = parse(discoverQuerySchema, request.query, 'search');
    const principal = await optionalAuth(request);

    const result = await discoverBusinesses(prisma, query, principal?.userId ?? null);

    return success(result.items, {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      total: result.total,
    });
  });

  app.get('/cafes/:idOrSlug', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string };
    const principal = await optionalAuth(request);

    const query = request.query as { latitude?: string; longitude?: string };
    const origin =
      query.latitude && query.longitude
        ? { latitude: Number(query.latitude), longitude: Number(query.longitude) }
        : null;

    const business = await getBusinessDetail(
      prisma,
      idOrSlug,
      principal?.userId ?? null,
      origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)
        ? origin
        : null,
    );

    return success(business);
  });

  app.get('/cafes/:idOrSlug/menu', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string };
    const business = await loadBusiness(prisma, idOrSlug);
    return success(await getMenu(prisma, business.id));
  });

  /**
   * Valid pickup times for this cafe, right now.
   *
   * Computed rather than stored: they depend on the schedule, the lead time and
   * how backed up the kitchen currently is.
   */
  app.get('/cafes/:idOrSlug/pickup-slots', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string };
    const business = await loadBusiness(prisma, idOrSlug);
    return success(await getPickupSlots(prisma, business));
  });

  app.get('/cafes/:idOrSlug/reviews', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string };
    const business = await loadBusiness(prisma, idOrSlug);

    const reviews = await prisma.review.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        user: { select: { profile: { select: { fullName: true, avatarUrl: true } } } },
      },
    });

    return success(reviews.map(toReview));
  });

  /** Menu-item search across cafes, e.g. "cold brew". */
  app.get('/search/items', async (request) => {
    const query = parse(searchMenuQuerySchema, request.query, 'search');

    const results = await searchMenuItems(query.q, {
      ...(query.cityId ? { cityId: query.cityId } : {}),
      limit: query.limit,
    });

    return success(results);
  });
}

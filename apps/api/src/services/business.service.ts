import {
  assessCapacity,
  boundingBox,
  describeAvailability,
  generatePickupSlots,
  haversineMeters,
  isOpenAt,
  isValidPickupTime,
  type ScheduleContext,
} from '@grabgo/core';
import type { BusinessDetail, BusinessSummary, Menu, PickupSlot } from '@grabgo/types';
import type { DiscoverQuery } from '@grabgo/validation';
import { type Prisma } from '@prisma/client';
import type { DbOrTx } from '../db';
import {
  businessWithRelations,
  menuItemWithOptions,
  toBusinessDetail,
  toBusinessSummary,
  toMenuCategory,
  type BusinessComputed,
  type BusinessWithRelations,
  type MenuItemWithOptions,
} from '../mappers';
import { HttpError, notFound } from '../lib/http-error';
import { hashPassword, randomToken } from '../lib/crypto';
import { getPlatformConfig } from './settings.service';

/**
 * Cafe discovery and availability.
 *
 * Two things this service is careful about:
 *
 *   1. Location is optional. Every path works without coordinates — the customer
 *      who declined the OS prompt browses by area instead of by distance.
 *   2. "Open" and "ready in ~N min" are computed live from the cafe's schedule and
 *      current load, not read from a stale column. A card that says "Open" when
 *      the shutters are down is worse than no card.
 */

/**
 * Discovery sorts by computed distance, which the database cannot order by
 * without PostGIS. A bounded candidate set is fetched, ranked in memory, then
 * paged. At launch scale (one city, tens of cafes) this is a single fast query;
 * the ceiling is the point at which PostGIS earns its keep.
 */
const MAX_CANDIDATES = 300;

export function buildSchedule(business: BusinessWithRelations): ScheduleContext {
  return {
    timeZone: business.timezone,
    weekly: business.hours.map((hour) => ({
      dayOfWeek: hour.dayOfWeek,
      opensAt: hour.opensAt,
      closesAt: hour.closesAt,
      isClosed: hour.isClosed,
    })),
    holidays: business.holidays.map((holiday) => ({
      date: holiday.date,
      isClosed: holiday.isClosed,
      opensAt: holiday.opensAt,
      closesAt: holiday.closesAt,
    })),
    temporarilyClosed: business.temporarilyClosed,
  };
}

export interface Availability {
  isOpenNow: boolean;
  label: string;
  /** Live lead time, stretched when the cafe is at its concurrency ceiling. */
  effectiveLeadMinutes: number;
  busyUntilMinutes: number | null;
  acceptsAsap: boolean;
  atCapacity: boolean;
}

export function computeAvailability(
  business: BusinessWithRelations,
  activeOrderCount: number,
  now: Date,
): Availability {
  const schedule = buildSchedule(business);
  const { isOpen, label } = describeAvailability(schedule, now);

  const capacity = assessCapacity({
    maxConcurrentOrders: business.maxConcurrentOrders,
    activeOrderCount,
    basePrepMinutes: business.prepTimeMinutes,
  });

  return {
    isOpenNow: isOpen,
    label: capacity.label ?? label,
    effectiveLeadMinutes: Math.max(
      business.minLeadTimeMinutes,
      capacity.effectiveLeadMinutes,
    ),
    busyUntilMinutes: capacity.busyForMinutes,
    acceptsAsap: capacity.acceptsAsap,
    atCapacity: capacity.atCapacity,
  };
}

/* ----------------------------------------------------------------- discovery */

export interface DiscoverResult {
  items: BusinessSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export async function discoverBusinesses(
  db: DbOrTx,
  query: DiscoverQuery,
  viewerId: string | null,
  now = new Date(),
): Promise<DiscoverResult> {
  const hasLocation =
    typeof query.latitude === 'number' && typeof query.longitude === 'number';

  const where: Prisma.BusinessWhereInput = {
    status: 'ACTIVE',
    deletedAt: null,
    ...(query.cityId ? { cityId: query.cityId } : {}),
    ...(query.areaId ? { areaId: query.areaId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.priceTier ? { priceTier: query.priceTier } : {}),
    ...(query.minRating ? { ratingAverage: { gte: query.minRating } } : {}),
    ...(query.maxPrepMinutes ? { prepTimeMinutes: { lte: query.maxPrepMinutes } } : {}),
    ...(query.tags && query.tags.length > 0 ? { tags: { hasSome: query.tags } } : {}),
  };

  if (hasLocation) {
    const box = boundingBox(
      { latitude: query.latitude as number, longitude: query.longitude as number },
      query.radiusMeters,
    );
    where.latitude = { gte: box.minLat, lte: box.maxLat };
    where.longitude = { gte: box.minLng, lte: box.maxLng };
  }

  if (query.q) {
    // Cafe name, description, or a tag. Menu-item search is a separate endpoint
    // so the two result shapes stay distinct in the UI.
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { description: { contains: query.q, mode: 'insensitive' } },
      { tags: { has: query.q.toLowerCase() } },
    ];
  }

  if (query.favouritesOnly) {
    if (!viewerId) return { items: [], nextCursor: null, hasMore: false, total: 0 };
    where.favourites = { some: { userId: viewerId } };
  }

  const candidates = await db.business.findMany({
    where,
    ...businessWithRelations,
    take: MAX_CANDIDATES,
    orderBy: [{ ratingAverage: 'desc' }, { createdAt: 'asc' }],
  });

  if (candidates.length === 0) {
    return { items: [], nextCursor: null, hasMore: false, total: 0 };
  }

  const ids = candidates.map((business) => business.id);
  const [favourites, activeCounts, popular] = await Promise.all([
    viewerId
      ? db.favourite.findMany({
          where: { userId: viewerId, businessId: { in: ids } },
          select: { businessId: true },
        })
      : Promise.resolve([]),
    db.order.groupBy({
      by: ['businessId'],
      where: { businessId: { in: ids }, status: { in: ['ACCEPTED', 'PREPARING'] } },
      _count: { _all: true },
    }),
    db.menuItem.findMany({
      where: { businessId: { in: ids }, isPopular: true, isAvailable: true, deletedAt: null },
      select: { businessId: true, name: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  const favouriteIds = new Set(favourites.map((row) => row.businessId));
  const activeByBusiness = new Map(
    activeCounts.map((row) => [row.businessId, row._count._all]),
  );
  const popularByBusiness = new Map<string, string[]>();
  for (const item of popular) {
    const existing = popularByBusiness.get(item.businessId) ?? [];
    if (existing.length < 3) existing.push(item.name);
    popularByBusiness.set(item.businessId, existing);
  }

  const origin = hasLocation
    ? { latitude: query.latitude as number, longitude: query.longitude as number }
    : null;

  let enriched = candidates.map((business) => {
    const availability = computeAvailability(
      business,
      activeByBusiness.get(business.id) ?? 0,
      now,
    );

    const distanceMeters = origin
      ? haversineMeters(origin, {
          latitude: business.latitude,
          longitude: business.longitude,
        })
      : null;

    const computed: BusinessComputed = {
      distanceMeters,
      isOpenNow: availability.isOpenNow,
      busyUntilMinutes: availability.busyUntilMinutes,
      isFavourite: favouriteIds.has(business.id),
      popularItems: popularByBusiness.get(business.id) ?? [],
      prepTimeMinutes: availability.effectiveLeadMinutes,
    };

    return toBusinessSummary(business, computed);
  });

  // The bounding box is a square; trim the corners to a true radius.
  if (origin) {
    enriched = enriched.filter(
      (business) =>
        business.distanceMeters !== null && business.distanceMeters <= query.radiusMeters,
    );
  }

  if (query.openNow) {
    enriched = enriched.filter((business) => business.isOpenNow);
  }

  enriched.sort(comparatorFor(query.sort));

  const offset = decodeOffsetCursor(query.cursor);
  const page = enriched.slice(offset, offset + query.limit);
  const hasMore = offset + query.limit < enriched.length;

  return {
    items: page,
    hasMore,
    nextCursor: hasMore ? encodeOffsetCursor(offset + query.limit) : null,
    total: enriched.length,
  };
}

function comparatorFor(
  sort: DiscoverQuery['sort'],
): (a: BusinessSummary, b: BusinessSummary) => number {
  const byDistance = (a: BusinessSummary, b: BusinessSummary): number =>
    (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) -
    (b.distanceMeters ?? Number.MAX_SAFE_INTEGER);

  switch (sort) {
    case 'NEAREST':
      return byDistance;
    case 'FASTEST':
      return (a, b) => a.prepTimeMinutes - b.prepTimeMinutes || byDistance(a, b);
    case 'RATING':
      return (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byDistance(a, b);
    case 'POPULAR':
      return (a, b) => b.reviewCount - a.reviewCount || byDistance(a, b);
    case 'RECOMMENDED':
    default:
      // Open cafes first — a closed one cannot fulfil the app's promise — then
      // rating, then proximity.
      return (a, b) => {
        if (a.isOpenNow !== b.isOpenNow) return a.isOpenNow ? -1 : 1;
        if (a.acceptingOrders !== b.acceptingOrders) return a.acceptingOrders ? -1 : 1;
        const rating = (b.rating ?? 0) - (a.rating ?? 0);
        if (Math.abs(rating) > 0.2) return rating;
        return byDistance(a, b);
      };
  }
}

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeOffsetCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const offset = (parsed as { o?: unknown }).o;
    return typeof offset === 'number' && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

/* -------------------------------------------------------------------- detail */

export async function loadBusiness(
  db: DbOrTx,
  idOrSlug: string,
): Promise<BusinessWithRelations> {
  const business = await db.business.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      deletedAt: null,
    },
    ...businessWithRelations,
  });

  if (!business) throw notFound('That cafe');
  return business;
}

export async function getBusinessDetail(
  db: DbOrTx,
  idOrSlug: string,
  viewerId: string | null,
  origin: { latitude: number; longitude: number } | null,
  now = new Date(),
): Promise<BusinessDetail> {
  const business = await loadBusiness(db, idOrSlug);

  const [favourite, activeCount, popular] = await Promise.all([
    viewerId
      ? db.favourite.findUnique({
          where: { userId_businessId: { userId: viewerId, businessId: business.id } },
          select: { id: true },
        })
      : Promise.resolve(null),
    db.order.count({
      where: { businessId: business.id, status: { in: ['ACCEPTED', 'PREPARING'] } },
    }),
    db.menuItem.findMany({
      where: { businessId: business.id, isPopular: true, isAvailable: true, deletedAt: null },
      select: { name: true },
      take: 3,
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  const availability = computeAvailability(business, activeCount, now);

  return toBusinessDetail(business, {
    distanceMeters: origin
      ? haversineMeters(origin, {
          latitude: business.latitude,
          longitude: business.longitude,
        })
      : null,
    isOpenNow: availability.isOpenNow,
    busyUntilMinutes: availability.busyUntilMinutes,
    isFavourite: favourite !== null,
    popularItems: popular.map((item) => item.name),
    prepTimeMinutes: availability.effectiveLeadMinutes,
  });
}

/* ---------------------------------------------------------------------- menu */

export async function getMenu(
  db: DbOrTx,
  businessId: string,
  options: { includeUnavailable?: boolean } = {},
): Promise<Menu> {
  const categories = await db.menuCategory.findMany({
    where: {
      businessId,
      ...(options.includeUnavailable ? {} : { isActive: true }),
    },
    orderBy: { sortOrder: 'asc' },
  });

  const items = await db.menuItem.findMany({
    where: {
      businessId,
      deletedAt: null,
      ...(options.includeUnavailable ? {} : { isAvailable: true }),
    },
    ...menuItemWithOptions,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const byCategory = new Map<string, MenuItemWithOptions[]>();
  for (const item of items) {
    const existing = byCategory.get(item.categoryId) ?? [];
    existing.push(item);
    byCategory.set(item.categoryId, existing);
  }

  const updatedAt = items.reduce<Date>(
    (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
    new Date(0),
  );

  return {
    businessId,
    categories: categories
      .map((category) => toMenuCategory(category, byCategory.get(category.id) ?? []))
      // An empty category is noise on a menu screen.
      .filter((category) => category.items.length > 0 || options.includeUnavailable),
    updatedAt: (updatedAt.getTime() === 0 ? new Date() : updatedAt).toISOString(),
  };
}

/* -------------------------------------------------------------- pickup slots */

export async function getPickupSlots(
  db: DbOrTx,
  business: BusinessWithRelations,
  now = new Date(),
): Promise<PickupSlot[]> {
  const platform = await getPlatformConfig(db);

  const activeCount = await db.order.count({
    where: { businessId: business.id, status: { in: ['ACCEPTED', 'PREPARING'] } },
  });

  const availability = computeAvailability(business, activeCount, now);

  const unavailable = business.maxOrdersPerSlot
    ? await fullSlotTimes(db, business.id, business.maxOrdersPerSlot, now)
    : [];

  return generatePickupSlots({
    now,
    schedule: buildSchedule(business),
    leadTimeMinutes: availability.effectiveLeadMinutes,
    intervalMinutes: platform.pickupSlotIntervalMinutes,
    maxAheadMinutes: Math.min(
      business.maxScheduleAheadMinutes,
      platform.maxScheduleAheadMinutes,
    ),
    unavailableSlots: unavailable,
    allowAsap: availability.acceptsAsap && business.acceptingOrders,
  });
}

async function fullSlotTimes(
  db: DbOrTx,
  businessId: string,
  maxOrdersPerSlot: number,
  now: Date,
): Promise<string[]> {
  const upcoming = await db.order.groupBy({
    by: ['pickupAt'],
    where: {
      businessId,
      pickupAt: { gte: now },
      status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'] },
    },
    _count: { _all: true },
  });

  return upcoming
    .filter((row) => row._count._all >= maxOrdersPerSlot)
    .map((row) => row.pickupAt.toISOString());
}

/**
 * Whether a cafe can take this order at this time.
 *
 * Called at checkout, after the customer has already seen a quote — the world can
 * change between quoting and paying, and it is better to refuse here than to take
 * money for a coffee nobody will make.
 */
export async function assertCanAcceptOrder(
  db: DbOrTx,
  business: BusinessWithRelations,
  pickupAt: Date,
  now = new Date(),
): Promise<void> {
  if (business.status !== 'ACTIVE') {
    throw new HttpError('BUSINESS_NOT_ACCEPTING_ORDERS', 'This cafe is not taking orders.');
  }

  if (!business.acceptingOrders || business.temporarilyClosed) {
    throw new HttpError(
      'BUSINESS_NOT_ACCEPTING_ORDERS',
      'This cafe has paused Grab & Go orders.',
    );
  }

  const schedule = buildSchedule(business);

  if (!isOpenAt(schedule, pickupAt)) {
    throw new HttpError('BUSINESS_CLOSED', 'This cafe is closed at that pickup time.');
  }

  const platform = await getPlatformConfig(db);
  const activeCount = await db.order.count({
    where: { businessId: business.id, status: { in: ['ACCEPTED', 'PREPARING'] } },
  });
  const availability = computeAvailability(business, activeCount, now);

  const valid = isValidPickupTime(pickupAt, {
    now,
    schedule,
    leadTimeMinutes: availability.effectiveLeadMinutes,
    intervalMinutes: platform.pickupSlotIntervalMinutes,
    maxAheadMinutes: Math.min(
      business.maxScheduleAheadMinutes,
      platform.maxScheduleAheadMinutes,
    ),
  });

  if (!valid) {
    throw new HttpError(
      'INVALID_PICKUP_TIME',
      'That pickup time is no longer available. Pick another slot.',
    );
  }

  if (business.maxOrdersPerSlot) {
    const taken = await db.order.count({
      where: {
        businessId: business.id,
        pickupAt,
        status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'] },
      },
    });

    if (taken >= business.maxOrdersPerSlot) {
      throw new HttpError(
        'BUSINESS_AT_CAPACITY',
        'That pickup time just filled up. Choose another slot.',
      );
    }
  }
}

/**
 * The owner account for a cafe being onboarded: the existing user with this
 * email (promoted to MERCHANT), or a new one with a temporary password the
 * admin passes on. Shared by "create a cafe" and "hand over an imported
 * listing", which must treat owners identically.
 */
export async function ensureOwner(
  tx: DbOrTx,
  email: string,
  fullName: string,
): Promise<{ id: string; temporaryPassword: string | null }> {
  const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await tx.user.update({ where: { id: existing.id }, data: { role: 'MERCHANT' } });
    return { id: existing.id, temporaryPassword: null };
  }

  const temporaryPassword = randomToken(9);
  const created = await tx.user.create({
    data: {
      email,
      passwordHash: await hashPassword(temporaryPassword),
      role: 'MERCHANT',
      referralCode: `CAFE${randomToken(5).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)}`,
      profile: { create: { fullName } },
    },
    select: { id: true },
  });
  return { id: created.id, temporaryPassword };
}

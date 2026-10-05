import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import type { AdminListing, ListingSummary } from '@grabgo/types';
import {
  adminListingsQuerySchema,
  claimListingSchema,
  listingsQuerySchema,
} from '@grabgo/validation';
import { prisma } from '../db';
import { parse } from '../lib/validate';
import { HttpError, notFound, success } from '../lib/http-error';
import { optionalAuth, requireAdmin, requireAuth } from '../lib/auth-context';
import { AuditAction, recordAudit } from '../services/audit.service';
import { ensureOwner } from '../services/business.service';

/**
 * Cafes that are on the map but not on Grab & Go yet.
 *
 * Imported from OpenStreetMap by `npm run db:import-osm`. An unclaimed listing
 * is PENDING_APPROVAL with ordering off, so discovery, menus and checkout never
 * see it; these routes are the only way in. Customers can ask for a cafe, and
 * admins hand a listing to its real owner, who adds a menu before approval.
 *
 * Listing data © OpenStreetMap contributors (ODbL); clients credit OSM.
 */

/** Imported, not yet handed to its owner, not deleted. */
const unclaimedWhere = {
  osmId: { not: null },
  claimedAt: null,
  deletedAt: null,
  status: 'PENDING_APPROVAL',
} satisfies Prisma.BusinessWhereInput;

const listingSelect = {
  id: true,
  name: true,
  addressLine: true,
  latitude: true,
  longitude: true,
  tags: true,
  area: { select: { name: true } },
  _count: { select: { partnerRequests: true } },
} satisfies Prisma.BusinessSelect;

type ListingRow = Prisma.BusinessGetPayload<{ select: typeof listingSelect }>;

function toListing(row: ListingRow, requested: Set<string>): ListingSummary {
  return {
    id: row.id,
    name: row.name,
    addressLine: row.addressLine,
    areaName: row.area?.name ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    tags: row.tags,
    requestCount: row._count.partnerRequests,
    requestedByMe: requested.has(row.id),
  };
}

async function requestedBy(userId: string | null, businessIds: string[]): Promise<Set<string>> {
  if (!userId || businessIds.length === 0) return new Set();
  const rows = await prisma.partnerRequest.findMany({
    where: { userId, businessId: { in: businessIds } },
    select: { businessId: true },
  });
  return new Set(rows.map((row) => row.businessId));
}

async function loadUnclaimed(id: string): Promise<ListingRow> {
  const row = await prisma.business.findFirst({
    where: { id, ...unclaimedWhere },
    select: listingSelect,
  });
  if (!row) throw notFound('That cafe');
  return row;
}

export async function registerListingRoutes(app: FastifyInstance): Promise<void> {
  /** Every unclaimed listing, optionally filtered to one category. */
  app.get('/listings', async (request) => {
    const query = parse(listingsQuerySchema, request.query, 'filters');
    const principal = await optionalAuth(request);

    const rows = await prisma.business.findMany({
      where: { ...unclaimedWhere, ...(query.tags ? { tags: { has: query.tags } } : {}) },
      select: listingSelect,
      orderBy: { name: 'asc' },
    });
    const requested = await requestedBy(
      principal?.userId ?? null,
      rows.map((row) => row.id),
    );

    return success(rows.map((row) => toListing(row, requested)));
  });

  app.get('/listings/:id', async (request) => {
    const { id } = request.params as { id: string };
    const principal = await optionalAuth(request);
    const row = await loadUnclaimed(id);
    const requested = await requestedBy(principal?.userId ?? null, [row.id]);
    return success(toListing(row, requested));
  });

  /** "I want to order here." Idempotent: asking twice still counts once. */
  app.post('/listings/:id/request', async (request) => {
    const principal = await requireAuth(request);
    const { id } = request.params as { id: string };
    await loadUnclaimed(id);

    await prisma.partnerRequest.upsert({
      where: { businessId_userId: { businessId: id, userId: principal.userId } },
      create: { businessId: id, userId: principal.userId },
      update: {},
    });

    const row = await loadUnclaimed(id);
    return success(toListing(row, new Set([id])));
  });

  /** Unclaimed listings, most requested first: who to approach next. */
  app.get('/admin/listings', async (request) => {
    await requireAdmin(request);
    const query = parse(adminListingsQuerySchema, request.query, 'filters');

    const rows = await prisma.business.findMany({
      where: {
        ...unclaimedWhere,
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      select: { ...listingSelect, osmId: true, phone: true, status: true, claimedAt: true },
      orderBy: [{ partnerRequests: { _count: 'desc' } }, { name: 'asc' }],
      take: query.limit,
    });

    const listings: AdminListing[] = rows.map((row) => ({
      ...toListing(row, new Set()),
      osmId: row.osmId ?? '',
      phone: row.phone,
      claimed: row.claimedAt !== null,
      status: row.status,
    }));
    return success(listings);
  });

  /**
   * Hand a listing to the cafe's real owner. It stays PENDING_APPROVAL with
   * ordering off; the owner adds a menu in the merchant dashboard, and
   * approval (which checks for one) is what finally makes it orderable.
   */
  app.post('/admin/listings/:id/claim', async (request, reply) => {
    const principal = await requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parse(claimListingSchema, request.body);
    await loadUnclaimed(id);

    const result = await prisma.$transaction(async (tx) => {
      const owner = await ensureOwner(tx, body.ownerEmail, body.ownerName);
      await tx.cafeStaff.create({
        data: { businessId: id, userId: owner.id, staffRole: 'OWNER' },
      });
      await tx.business.update({ where: { id }, data: { claimedAt: new Date() } });
      return { businessId: id, ownerId: owner.id, temporaryPassword: owner.temporaryPassword };
    });

    await recordAudit(prisma, {
      actorUserId: principal.userId,
      action: AuditAction.LISTING_CLAIMED,
      targetType: 'business',
      targetId: id,
      newValue: { ownerEmail: body.ownerEmail },
    });

    return reply.code(201).send(success(result));
  });
}

/**
 * Approval guard for imported listings: a cafe with no owner or no menu would
 * take money for coffee nobody makes. Partner cafes created by admins already
 * have an owner, and their menus are their own business, so only imported
 * listings are held to this.
 */
export async function assertListingReadyForApproval(
  db: Prisma.TransactionClient | typeof prisma,
  businessId: string,
): Promise<{ imported: boolean }> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      osmId: true,
      claimedAt: true,
      _count: { select: { menuItems: { where: { deletedAt: null } } } },
    },
  });
  if (!business?.osmId) return { imported: false };

  if (!business.claimedAt) {
    throw new HttpError(
      'LISTING_NOT_CLAIMED',
      'This cafe has not signed up yet. Onboard its owner before approving it.',
    );
  }
  if (business._count.menuItems === 0) {
    throw new HttpError(
      'LISTING_HAS_NO_MENU',
      'This cafe has no menu yet. Its owner adds one from the merchant dashboard.',
    );
  }
  return { imported: true };
}

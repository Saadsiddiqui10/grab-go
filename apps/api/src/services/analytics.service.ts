import type { AdminAnalytics, MerchantAnalytics } from '@grabgo/types';
import type { AnalyticsBatchInput } from '@grabgo/validation';
import type { OrderStatus } from '@prisma/client';
import { prisma } from '../db';

/**
 * Analytics.
 *
 * Two jobs: ingesting product events from the clients, and answering the
 * dashboards' questions about orders and revenue.
 *
 * Event ingestion is deliberately lossy — a dropped analytics write must never
 * surface as an error in the app — and property values are capped in size and
 * type by the schema, so a client cannot use this endpoint as free storage or
 * accidentally ship a customer's typed note into the warehouse.
 */

export async function recordEvents(
  input: AnalyticsBatchInput,
  context: { userId?: string | null; sessionId?: string | null },
): Promise<void> {
  try {
    await prisma.analyticsEvent.createMany({
      data: input.events.map((event) => ({
        userId: context.userId ?? null,
        sessionId: context.sessionId ?? null,
        event: event.event,
        properties: event.properties ?? undefined,
        occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
      })),
    });
  } catch (error) {
    console.error('[analytics] failed to record events', error);
  }
}

export type RangePreset = 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export function resolveRange(
  preset: RangePreset,
  from?: string,
  to?: string,
): { start: Date; end: Date } {
  if (from && to) return { start: new Date(from), end: new Date(to) };

  const end = new Date();
  const start = new Date(end);

  switch (preset) {
    case 'TODAY':
      start.setHours(0, 0, 0, 0);
      break;
    case 'WEEK':
      start.setDate(start.getDate() - 7);
      break;
    case 'MONTH':
      start.setMonth(start.getMonth() - 1);
      break;
    case 'QUARTER':
      start.setMonth(start.getMonth() - 3);
      break;
    case 'YEAR':
      start.setFullYear(start.getFullYear() - 1);
      break;
  }

  return { start, end };
}

/** An order counts toward revenue once the customer has actually collected it. */
const SETTLED_STATUSES: OrderStatus[] = ['PICKED_UP', 'COMPLETED'];

/* ------------------------------------------------------------------ merchant */

export async function getMerchantAnalytics(
  businessId: string,
  range: { start: Date; end: Date },
): Promise<MerchantAnalytics> {
  const where = { businessId, createdAt: { gte: range.start, lte: range.end } };

  const [orders, completed, cancelled, revenue, topItems] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...where, status: { in: SETTLED_STATUSES } } }),
    prisma.order.count({
      where: {
        ...where,
        status: {
          in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_CAFE', 'CANCELLED_BY_ADMIN', 'EXPIRED'],
        },
      },
    }),
    prisma.order.aggregate({
      where: { ...where, status: { in: SETTLED_STATUSES } },
      _sum: { total: true, merchantEarnings: true },
      _avg: { total: true },
    }),
    prisma.orderItem.groupBy({
      by: ['menuItemId', 'name'],
      where: { order: { ...where, status: { in: SETTLED_STATUSES } } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    }),
  ]);

  const settled = await prisma.order.findMany({
    where: { ...where, status: { in: SETTLED_STATUSES } },
    select: { userId: true, createdAt: true, total: true, acceptedAt: true, readyAt: true },
  });

  // A repeat customer is one who appears more than once in the window.
  const perCustomer = new Map<string, number>();
  for (const order of settled) {
    perCustomer.set(order.userId, (perCustomer.get(order.userId) ?? 0) + 1);
  }
  const repeatCustomers = [...perCustomer.values()].filter((count) => count > 1).length;

  const prepDurations = settled
    .filter((order) => order.acceptedAt && order.readyAt)
    .map(
      (order) =>
        ((order.readyAt as Date).getTime() - (order.acceptedAt as Date).getTime()) / 60_000,
    );

  return {
    rangeStart: range.start.toISOString(),
    rangeEnd: range.end.toISOString(),
    orderCount: orders,
    completedCount: completed,
    cancelledCount: cancelled,
    grossRevenue: revenue._sum?.total ?? 0,
    netEarnings: revenue._sum?.merchantEarnings ?? 0,
    averageOrderValue: Math.round(revenue._avg?.total ?? 0),
    averagePrepMinutes:
      prepDurations.length > 0
        ? Math.round(
            (prepDurations.reduce((total, value) => total + value, 0) /
              prepDurations.length) *
              10,
          ) / 10
        : null,
    repeatCustomerRate:
      perCustomer.size > 0 ? repeatCustomers / perCustomer.size : 0,
    topItems: topItems.map((row) => ({
      menuItemId: row.menuItemId ?? '',
      name: row.name,
      quantity: row._sum?.quantity ?? 0,
      revenue: row._sum?.lineTotal ?? 0,
    })),
    ordersByDay: bucketByDay(settled),
  };
}

/* --------------------------------------------------------------------- admin */

export async function getAdminAnalytics(range: {
  start: Date;
  end: Date;
}): Promise<AdminAnalytics> {
  const where = { createdAt: { gte: range.start, lte: range.end } };

  const [
    orderCount,
    revenue,
    newUsers,
    pointsIssued,
    pointsRedeemed,
    rewardsRedeemed,
    referralSignups,
    referralConversions,
    topBusinessRows,
    topProducts,
  ] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.aggregate({
      where: { ...where, status: { in: SETTLED_STATUSES } },
      _sum: { total: true, platformCommission: true },
      _avg: { total: true },
    }),
    prisma.user.count({ where: { ...where, role: 'CUSTOMER' } }),
    prisma.pointsTransaction.aggregate({
      where: { ...where, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.pointsTransaction.aggregate({
      where: { ...where, type: 'REWARD_REDEMPTION' },
      _sum: { amount: true },
    }),
    prisma.rewardRedemption.count({ where }),
    prisma.referral.count({ where: { signedUpAt: where.createdAt } }),
    prisma.referral.count({
      where: { qualifiedAt: where.createdAt, status: { in: ['QUALIFIED', 'REWARDED'] } },
    }),
    prisma.order.groupBy({
      by: ['businessId'],
      where: { ...where, status: { in: SETTLED_STATUSES } },
      _count: true,
      _sum: { total: true },
      orderBy: { _count: { businessId: 'desc' } },
      take: 10,
    }),
    prisma.orderItem.groupBy({
      by: ['menuItemId', 'name'],
      where: { order: { ...where, status: { in: SETTLED_STATUSES } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    }),
  ]);

  const settled = await prisma.order.findMany({
    where: { ...where, status: { in: SETTLED_STATUSES } },
    select: { userId: true, createdAt: true, total: true },
  });

  const perCustomer = new Map<string, number>();
  for (const order of settled) {
    perCustomer.set(order.userId, (perCustomer.get(order.userId) ?? 0) + 1);
  }
  const repeatUsers = [...perCustomer.values()].filter((count) => count > 1).length;

  const businessNames = await prisma.business.findMany({
    where: { id: { in: topBusinessRows.map((row) => row.businessId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(businessNames.map((row) => [row.id, row.name]));

  return {
    rangeStart: range.start.toISOString(),
    rangeEnd: range.end.toISOString(),
    orderCount,
    grossRevenue: revenue._sum?.total ?? 0,
    platformCommission: revenue._sum?.platformCommission ?? 0,
    averageOrderValue: Math.round(revenue._avg?.total ?? 0),
    activeUsers: perCustomer.size,
    newUsers,
    repeatUserRate: perCustomer.size > 0 ? repeatUsers / perCustomer.size : 0,
    pointsIssued: pointsIssued._sum?.amount ?? 0,
    // Stored as negative ledger entries; report the magnitude.
    pointsRedeemed: Math.abs(pointsRedeemed._sum?.amount ?? 0),
    rewardsRedeemed,
    referralSignups,
    referralConversions,
    topBusinesses: topBusinessRows.map((row) => ({
      businessId: row.businessId,
      name: nameById.get(row.businessId) ?? 'Unknown',
      orders: row._count,
      revenue: row._sum?.total ?? 0,
    })),
    topProducts: topProducts.map((row) => ({
      menuItemId: row.menuItemId ?? '',
      name: row.name,
      quantity: row._sum?.quantity ?? 0,
    })),
    ordersByDay: bucketByDay(settled),
  };
}

function bucketByDay(
  orders: Array<{ createdAt: Date; total: number }>,
): Array<{ date: string; orders: number; revenue: number }> {
  const buckets = new Map<string, { orders: number; revenue: number }>();

  for (const order of orders) {
    const key = order.createdAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key) ?? { orders: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue += order.total;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([date, bucket]) => ({ date, ...bucket }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

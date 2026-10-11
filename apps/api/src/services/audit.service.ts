import type { ActorType } from '@prisma/client';
import type { DbOrTx } from '../db';

/**
 * Audit logging for privileged actions.
 *
 * Anything an admin or merchant does that changes someone else's money, access or
 * order lands here with before/after values. Writes are best-effort: an audit
 * failure must never roll back the action it was describing, but it does get
 * logged loudly.
 */

export const AuditAction = {
  BUSINESS_CREATED: 'business.created',
  POS_CONFIGURED: 'pos.configured',
  POS_SECRET_ROTATED: 'pos.secret_rotated',
  POS_RETRIED: 'pos.retried',
  BUSINESS_APPROVED: 'business.approved',
  BUSINESS_REJECTED: 'business.rejected',
  BUSINESS_SUSPENDED: 'business.suspended',
  BUSINESS_REINSTATED: 'business.reinstated',
  BUSINESS_UPDATED: 'business.updated',
  LISTING_CLAIMED: 'listing.claimed',
  USER_SUSPENDED: 'user.suspended',
  USER_RESTORED: 'user.restored',
  USER_DELETED: 'user.deleted',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_REFUNDED: 'order.refunded',
  ORDER_STATUS_FORCED: 'order.status_forced',
  POINTS_ADJUSTED: 'points.adjusted',
  REWARD_CREATED: 'reward.created',
  REWARD_UPDATED: 'reward.updated',
  PROMOTION_CREATED: 'promotion.created',
  PROMOTION_UPDATED: 'promotion.updated',
  CONFIG_UPDATED: 'config.updated',
  STAFF_INVITED: 'staff.invited',
  STAFF_UPDATED: 'staff.updated',
  STAFF_REMOVED: 'staff.removed',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  actorUserId?: string | null;
  actorType?: ActorType;
  action: AuditAction | string;
  targetType: string;
  targetId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        actorType: entry.actorType ?? 'ADMIN',
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        previousValue: toJson(entry.previousValue),
        newValue: toJson(entry.newValue),
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent?.slice(0, 255) ?? null,
      },
    });
  } catch (error) {
    // Never let bookkeeping fail the operation it describes.
    console.error('[audit] failed to record entry', entry.action, error);
  }
}

function toJson(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') return value as object;
  return { value };
}

/** Diff two records down to what actually changed, so the log stays readable. */
export function diffFields<T extends object>(
  before: T,
  after: Partial<T>,
): { previous: Partial<T>; next: Partial<T> } {
  const previous: Partial<T> = {};
  const next: Partial<T> = {};

  for (const key of Object.keys(after) as Array<keyof T>) {
    const incoming = after[key];
    if (incoming === undefined) continue;
    if (Object.is(before[key], incoming)) continue;
    previous[key] = before[key];
    next[key] = incoming;
  }

  return { previous, next };
}

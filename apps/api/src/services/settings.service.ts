import {
  ConfigKey,
  DEFAULT_LOYALTY_CONFIG,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_REFERRAL_CONFIG,
  type LoyaltyConfig,
  type PlatformConfig,
  type ReferralConfig,
} from '@grabgo/types';
import type { DbOrTx } from '../db';

/**
 * Runtime business configuration.
 *
 * "Rs. 100 = 1 point" and "3 referrals earn a free coffee" are *data*, editable
 * from the admin panel, not constants in a handler. This service is the only way
 * to read them, so no code path can accidentally hardcode a rule.
 *
 * Values are cached briefly: these are read on nearly every order, change rarely,
 * and a few seconds of staleness after an admin edit is an acceptable trade for
 * not querying settings on every checkout.
 */

const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearSettingsCache(): void {
  cache.clear();
}

async function readSetting<T>(db: DbOrTx, key: string, fallback: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const row = await db.platformSetting.findUnique({ where: { key } });

  // Merge over the defaults so a config written before a new field existed does
  // not leave that field undefined at the call site.
  const value = row ? { ...fallback, ...(row.value as object) } : fallback;

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value as T;
}

export function getLoyaltyConfig(db: DbOrTx): Promise<LoyaltyConfig> {
  return readSetting(db, ConfigKey.LOYALTY, DEFAULT_LOYALTY_CONFIG);
}

export function getReferralConfig(db: DbOrTx): Promise<ReferralConfig> {
  return readSetting(db, ConfigKey.REFERRAL, DEFAULT_REFERRAL_CONFIG);
}

export function getPlatformConfig(db: DbOrTx): Promise<PlatformConfig> {
  return readSetting(db, ConfigKey.PLATFORM, DEFAULT_PLATFORM_CONFIG);
}

export async function writeSetting<T extends object>(
  db: DbOrTx,
  key: string,
  value: T,
  updatedById?: string,
): Promise<T> {
  await db.platformSetting.upsert({
    where: { key },
    create: { key, value: value as object, updatedById: updatedById ?? null },
    update: { value: value as object, updatedById: updatedById ?? null },
  });

  cache.delete(key);
  return value;
}

/** Every config the clients need in one call, for app bootstrap. */
export async function getPublicConfig(db: DbOrTx): Promise<{
  loyalty: Pick<LoyaltyConfig, 'earnRateAmount' | 'earnRatePoints' | 'isEnabled' | 'pointsMultiplier'>;
  referral: Pick<ReferralConfig, 'referralsRequiredForReward' | 'isEnabled'>;
  platform: Pick<PlatformConfig, 'pickupSlotIntervalMinutes' | 'minimumOrderTotal'>;
}> {
  const [loyalty, referral, platform] = await Promise.all([
    getLoyaltyConfig(db),
    getReferralConfig(db),
    getPlatformConfig(db),
  ]);

  // Deliberately partial: abuse thresholds and accept windows are operational
  // details a client has no need to know.
  return {
    loyalty: {
      earnRateAmount: loyalty.earnRateAmount,
      earnRatePoints: loyalty.earnRatePoints,
      pointsMultiplier: loyalty.pointsMultiplier,
      isEnabled: loyalty.isEnabled,
    },
    referral: {
      referralsRequiredForReward: referral.referralsRequiredForReward,
      isEnabled: referral.isEnabled,
    },
    platform: {
      pickupSlotIntervalMinutes: platform.pickupSlotIntervalMinutes,
      minimumOrderTotal: platform.minimumOrderTotal,
    },
  };
}

/**
 * Runtime-configurable business rules.
 *
 * Nothing here is a constant in the codebase: every value is stored in the database
 * and editable from the admin panel. The literals below are *bootstrap defaults*
 * used to seed a fresh install, never read directly by request handlers.
 */
import type { Paisa } from './money';

export interface LoyaltyConfig {
  /** Points are earned per this many paisa of eligible spend. */
  earnRateAmount: Paisa;
  /** Points granted per `earnRateAmount`. */
  earnRatePoints: number;
  /**
   * Which part of the order earns points. `SUBTOTAL` (pre-discount) rewards basket
   * size; `NET` (post-discount, pre-tax) protects margin. Configurable either way.
   */
  earnBasis: 'SUBTOTAL' | 'NET';
  /** Global multiplier for promotional periods. 1 = off, 2 = double points. */
  pointsMultiplier: number;
  /** Points expire this many days after being earned. 0 disables expiry. */
  expiryDays: number;
  /** Points are only granted once an order reaches this status. */
  awardOnStatus: 'PICKED_UP' | 'COMPLETED';
  /** Minimum order value that earns any points at all. */
  minimumSpendForPoints: Paisa;
  isEnabled: boolean;
}

export interface ReferralConfig {
  /** Qualified referrals needed before the referrer's reward is issued. */
  referralsRequiredForReward: number;
  /** Points given to the referrer per qualified referral (may be 0). */
  referrerPointsPerQualified: number;
  /** Reward issued to the referrer once the threshold is met. */
  referrerRewardId: string | null;
  /** Reward given to the new user at signup. */
  refereeRewardId: string | null;
  /** Points given to the new user at signup. */
  refereeSignupPoints: number;
  /** The referred user's first order must be at least this much to qualify. */
  minimumQualifyingOrderTotal: Paisa;
  /** Qualification requires the referee's order to reach this status. */
  qualifyOnStatus: 'PICKED_UP' | 'COMPLETED';
  /** Referee must verify a phone number before a referral can qualify. */
  requireVerifiedPhone: boolean;
  /** Cap on qualified referrals per referrer per rolling 30 days. Abuse guard. */
  maxQualifiedPerMonth: number;
  isEnabled: boolean;
}

export interface PlatformConfig {
  defaultCommissionBasisPoints: number;
  defaultTaxBasisPoints: number;
  /** Slot granularity for scheduled pickup, in minutes. */
  pickupSlotIntervalMinutes: number;
  /** How far ahead a customer may schedule, in minutes. */
  maxScheduleAheadMinutes: number;
  /** Grace period after `pickupAt` before an unclaimed order is flagged. */
  pickupGraceMinutes: number;
  /** Minutes a cafe has to accept a PENDING order before auto-expiry. */
  merchantAcceptWindowMinutes: number;
  /** Customers may self-cancel until the order is accepted, plus this grace. */
  customerCancelWindowMinutes: number;
  minimumOrderTotal: Paisa;
  maxPickupCodeAttempts: number;
}

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  earnRateAmount: 10_000,
  earnRatePoints: 1,
  earnBasis: 'NET',
  pointsMultiplier: 1,
  expiryDays: 365,
  awardOnStatus: 'PICKED_UP',
  minimumSpendForPoints: 0,
  isEnabled: true,
};

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  referralsRequiredForReward: 3,
  referrerPointsPerQualified: 50,
  referrerRewardId: null,
  refereeRewardId: null,
  refereeSignupPoints: 0,
  minimumQualifyingOrderTotal: 30_000,
  qualifyOnStatus: 'PICKED_UP',
  requireVerifiedPhone: true,
  maxQualifiedPerMonth: 20,
  isEnabled: true,
};

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  defaultCommissionBasisPoints: 1_000,
  defaultTaxBasisPoints: 0,
  pickupSlotIntervalMinutes: 15,
  maxScheduleAheadMinutes: 24 * 60,
  pickupGraceMinutes: 30,
  merchantAcceptWindowMinutes: 10,
  customerCancelWindowMinutes: 2,
  minimumOrderTotal: 0,
  maxPickupCodeAttempts: 5,
};

/** Keys used in the `platform_settings` table. */
export const ConfigKey = {
  LOYALTY: 'loyalty',
  REFERRAL: 'referral',
  PLATFORM: 'platform',
} as const;
export type ConfigKey = (typeof ConfigKey)[keyof typeof ConfigKey];

import { ReferralStatus, type Paisa, type ReferralConfig } from '@grabgo/types';
import { fail, ok, type Result } from './errors';
import type { RandomBytes } from './pickup-verification';

/**
 * Referral qualification and abuse prevention.
 *
 * Signing up is never enough. A referral only qualifies once the invited user has
 * actually paid for and collected a real order — the exact bar is configurable, but
 * the shape of the rule is fixed here so no code path can shortcut it.
 */

const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Build a shareable code from the user's name, e.g. "SAAD" + "123".
 *
 * The name prefix makes the code feel personal (and easier to say out loud); the
 * random suffix is what actually makes it unique. Callers retry on collision
 * against the unique index.
 */
export function generateReferralCode(
  displayName: string,
  randomBytes: RandomBytes,
  suffixLength = 3,
): string {
  // First name only: "Saad Siddiqui" gives SAAD###, not SAADS###.
  const prefix = (displayName.trim().split(/\s+/)[0] ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 5);

  const limit = Math.floor(256 / REFERRAL_ALPHABET.length) * REFERRAL_ALPHABET.length;
  let suffix = '';

  while (suffix.length < suffixLength) {
    for (const byte of randomBytes(suffixLength * 2)) {
      if (suffix.length >= suffixLength) break;
      if (byte >= limit) continue;
      suffix += REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length];
    }
  }

  return `${prefix || 'GRAB'}${suffix}`;
}

export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

/* --------------------------------------------------------- claiming a referral */

export interface ReferralClaimInput {
  referrerId: string | null;
  refereeId: string;
  /** True when this account has already been attributed to someone. */
  refereeAlreadyReferred: boolean;
  /**
   * Signals that this signup is not an independent person. Supplied by the API
   * from device id / IP / phone-prefix heuristics.
   */
  duplicateDeviceSignups?: number;
  maxSignupsPerDevice?: number;
}

/** Validate a referral code at signup, before any reward exists. */
export function checkReferralClaim(input: ReferralClaimInput): Result<{ referrerId: string }> {
  if (!input.referrerId) {
    return fail('REFERRAL_CODE_INVALID', 'That referral code does not exist.');
  }

  if (input.referrerId === input.refereeId) {
    return fail('REFERRAL_SELF', 'You cannot refer yourself.');
  }

  if (input.refereeAlreadyReferred) {
    return fail(
      'REFERRAL_ALREADY_USED',
      'This account has already used a referral code.',
    );
  }

  const perDeviceLimit = input.maxSignupsPerDevice ?? 3;
  if ((input.duplicateDeviceSignups ?? 0) >= perDeviceLimit) {
    return fail(
      'REFERRAL_ALREADY_USED',
      'Too many accounts have been created from this device.',
      { duplicateDeviceSignups: input.duplicateDeviceSignups },
    );
  }

  return ok({ referrerId: input.referrerId });
}

/* ----------------------------------------------------------- qualifying an order */

export interface ReferralQualificationInput {
  config: ReferralConfig;
  referralStatus: (typeof ReferralStatus)[keyof typeof ReferralStatus];
  /** Status the referred user's order just reached. */
  orderStatus: 'PICKED_UP' | 'COMPLETED' | string;
  orderTotal: Paisa;
  /** True only for the referee's first order that reached a qualifying status. */
  isFirstQualifyingOrder: boolean;
  refereePhoneVerified: boolean;
  /** Referrals this referrer has already had qualify in the trailing 30 days. */
  referrerQualifiedLast30Days: number;
  /** Total qualified referrals for this referrer, before this one. */
  referrerQualifiedTotal: number;
}

export interface ReferralQualificationOutcome {
  qualifies: boolean;
  /** Points to credit the referrer for this qualified referral. */
  referrerPoints: number;
  /** True when this referral crosses the configured threshold. */
  unlocksReferrerReward: boolean;
  reason?: string;
}

/**
 * Decide whether a completed order turns a PENDING referral into a QUALIFIED one.
 *
 * Returns an outcome rather than throwing: this runs inside order completion, and
 * a referral that does not qualify must never fail the order.
 */
export function evaluateReferralQualification(
  input: ReferralQualificationInput,
): ReferralQualificationOutcome {
  const decline = (reason: string): ReferralQualificationOutcome => ({
    qualifies: false,
    referrerPoints: 0,
    unlocksReferrerReward: false,
    reason,
  });

  const { config } = input;

  if (!config.isEnabled) return decline('Referral programme is disabled.');
  if (input.referralStatus !== ReferralStatus.PENDING) {
    return decline('Referral has already been settled.');
  }
  if (!input.isFirstQualifyingOrder) {
    return decline('Only the first qualifying order counts.');
  }
  if (input.orderStatus !== config.qualifyOnStatus) {
    return decline(`Order has not reached ${config.qualifyOnStatus}.`);
  }
  if (input.orderTotal < config.minimumQualifyingOrderTotal) {
    return decline('Order total is below the qualifying minimum.');
  }
  if (config.requireVerifiedPhone && !input.refereePhoneVerified) {
    return decline('Referred user has not verified a phone number.');
  }
  if (input.referrerQualifiedLast30Days >= config.maxQualifiedPerMonth) {
    return decline('Referrer has hit the monthly referral cap.');
  }

  const qualifiedAfter = input.referrerQualifiedTotal + 1;
  const threshold = Math.max(1, config.referralsRequiredForReward);

  return {
    qualifies: true,
    referrerPoints: Math.max(0, config.referrerPointsPerQualified),
    // Fires on every multiple of the threshold, so a fourth, fifth and sixth
    // invite keep earning rather than stopping after the first free coffee.
    unlocksReferrerReward: qualifiedAfter % threshold === 0,
  };
}

/** Progress copy for the invite screen. */
export function referralProgressLabel(
  qualifiedCount: number,
  config: ReferralConfig,
): string {
  const threshold = Math.max(1, config.referralsRequiredForReward);
  const within = qualifiedCount % threshold;
  const remaining = threshold - within;

  if (qualifiedCount > 0 && within === 0) {
    return 'Your reward is ready. Invite more friends to earn another.';
  }

  return `${remaining} more friend${remaining === 1 ? '' : 's'} until your free coffee.`;
}

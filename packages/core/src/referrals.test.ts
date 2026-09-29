import { describe, expect, it } from 'vitest';
import { DEFAULT_REFERRAL_CONFIG, type ReferralConfig } from '@grabgo/types';
import {
  checkReferralClaim,
  evaluateReferralQualification,
  generateReferralCode,
  normalizeReferralCode,
  referralProgressLabel,
  type ReferralQualificationInput,
} from './referrals';

const fixedBytes = (size: number): Uint8Array =>
  Uint8Array.from({ length: size }, (_, index) => index);

const config = (overrides: Partial<ReferralConfig> = {}): ReferralConfig => ({
  ...DEFAULT_REFERRAL_CONFIG,
  ...overrides,
});

describe('generateReferralCode', () => {
  it('builds a personal-looking code from the name', () => {
    const code = generateReferralCode('Saad Siddiqui', fixedBytes);
    expect(code.startsWith('SAAD')).toBe(true);
    expect(code).toHaveLength(7);
  });

  it('falls back when the name has no letters', () => {
    expect(generateReferralCode('123', fixedBytes).startsWith('GRAB')).toBe(true);
  });

  it('normalises user input', () => {
    expect(normalizeReferralCode(' saad-123 ')).toBe('SAAD123');
  });
});

describe('checkReferralClaim', () => {
  it('accepts a genuine referral', () => {
    const result = checkReferralClaim({
      referrerId: 'user_a',
      refereeId: 'user_b',
      refereeAlreadyReferred: false,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown code', () => {
    const result = checkReferralClaim({
      referrerId: null,
      refereeId: 'user_b',
      refereeAlreadyReferred: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('REFERRAL_CODE_INVALID');
  });

  it('rejects self-referral', () => {
    const result = checkReferralClaim({
      referrerId: 'user_a',
      refereeId: 'user_a',
      refereeAlreadyReferred: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('REFERRAL_SELF');
  });

  it('rejects a second referral on the same account', () => {
    const result = checkReferralClaim({
      referrerId: 'user_a',
      refereeId: 'user_b',
      refereeAlreadyReferred: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('REFERRAL_ALREADY_USED');
  });

  it('rejects an account farm on one device', () => {
    const result = checkReferralClaim({
      referrerId: 'user_a',
      refereeId: 'user_b',
      refereeAlreadyReferred: false,
      duplicateDeviceSignups: 5,
      maxSignupsPerDevice: 3,
    });
    expect(result.ok).toBe(false);
  });
});

describe('evaluateReferralQualification', () => {
  const base: ReferralQualificationInput = {
    config: config(),
    referralStatus: 'PENDING',
    orderStatus: 'PICKED_UP',
    orderTotal: 65000,
    isFirstQualifyingOrder: true,
    refereePhoneVerified: true,
    referrerQualifiedLast30Days: 0,
    referrerQualifiedTotal: 0,
  };

  it('qualifies once the invited friend collects their first order', () => {
    const outcome = evaluateReferralQualification(base);
    expect(outcome.qualifies).toBe(true);
    expect(outcome.referrerPoints).toBe(50);
  });

  it('does not qualify on signup alone', () => {
    const outcome = evaluateReferralQualification({ ...base, orderStatus: 'PENDING' });
    expect(outcome.qualifies).toBe(false);
  });

  it('does not qualify below the minimum order total', () => {
    const outcome = evaluateReferralQualification({ ...base, orderTotal: 10000 });
    expect(outcome.qualifies).toBe(false);
  });

  it('does not qualify twice for the same friend', () => {
    const outcome = evaluateReferralQualification({
      ...base,
      isFirstQualifyingOrder: false,
    });
    expect(outcome.qualifies).toBe(false);
  });

  it('does not re-reward an already settled referral', () => {
    const outcome = evaluateReferralQualification({ ...base, referralStatus: 'REWARDED' });
    expect(outcome.qualifies).toBe(false);
  });

  it('requires a verified phone when configured', () => {
    expect(
      evaluateReferralQualification({ ...base, refereePhoneVerified: false }).qualifies,
    ).toBe(false);

    expect(
      evaluateReferralQualification({
        ...base,
        refereePhoneVerified: false,
        config: config({ requireVerifiedPhone: false }),
      }).qualifies,
    ).toBe(true);
  });

  it('enforces the monthly cap against farming', () => {
    const outcome = evaluateReferralQualification({
      ...base,
      referrerQualifiedLast30Days: 20,
    });
    expect(outcome.qualifies).toBe(false);
  });

  it('unlocks the reward on the configured multiple, not a hardcoded three', () => {
    const first = evaluateReferralQualification({ ...base, referrerQualifiedTotal: 0 });
    const second = evaluateReferralQualification({ ...base, referrerQualifiedTotal: 1 });
    const third = evaluateReferralQualification({ ...base, referrerQualifiedTotal: 2 });

    expect(first.unlocksReferrerReward).toBe(false);
    expect(second.unlocksReferrerReward).toBe(false);
    expect(third.unlocksReferrerReward).toBe(true);

    const two = evaluateReferralQualification({
      ...base,
      referrerQualifiedTotal: 1,
      config: config({ referralsRequiredForReward: 2 }),
    });
    expect(two.unlocksReferrerReward).toBe(true);
  });

  it('keeps rewarding beyond the first threshold', () => {
    const sixth = evaluateReferralQualification({ ...base, referrerQualifiedTotal: 5 });
    expect(sixth.unlocksReferrerReward).toBe(true);
  });

  it('stays quiet when the programme is disabled', () => {
    const outcome = evaluateReferralQualification({
      ...base,
      config: config({ isEnabled: false }),
    });
    expect(outcome.qualifies).toBe(false);
  });
});

describe('referralProgressLabel', () => {
  it('counts down to the next reward', () => {
    expect(referralProgressLabel(0, config())).toContain('3 more friends');
    expect(referralProgressLabel(2, config())).toContain('1 more friend');
  });

  it('celebrates a completed set', () => {
    expect(referralProgressLabel(3, config())).toContain('reward is ready');
  });
});

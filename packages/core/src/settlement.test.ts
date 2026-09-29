import { describe, expect, it } from 'vitest';
import { computeRefundSplit, computeSettlement } from './settlement';
import { assessCapacity, estimateReadyMinutes } from './capacity';
import { boundingBox, formatDistance, haversineMeters } from './geo';

describe('computeSettlement', () => {
  const order = {
    subtotal: 120000,
    discountTotal: 0,
    tax: 0,
    total: 120000,
    commissionBasisPoints: 1000,
  };

  it('takes commission on merchandise', () => {
    const settlement = computeSettlement(order);
    expect(settlement.platformCommission).toBe(12000);
    expect(settlement.merchantEarnings).toBe(108000);
  });

  it('passes tax through to the merchant untaxed by commission', () => {
    const settlement = computeSettlement({ ...order, tax: 6000, total: 126000 });
    expect(settlement.platformCommission).toBe(12000);
    expect(settlement.merchantEarnings).toBe(114000);
  });

  it('does not charge the cafe for a platform-funded promo', () => {
    const settlement = computeSettlement({
      ...order,
      discountTotal: 20000,
      total: 100000,
      discountFundedBy: 'PLATFORM',
    });
    // The cafe is still paid on the full basket; the platform absorbs the discount.
    expect(settlement.merchantEarnings).toBe(108000);
    expect(settlement.platformNet).toBeLessThan(0);
  });

  it('charges the cafe for its own discount', () => {
    const settlement = computeSettlement({
      ...order,
      discountTotal: 20000,
      total: 100000,
      discountFundedBy: 'MERCHANT',
    });
    expect(settlement.netMerchandise).toBe(100000);
    expect(settlement.platformCommission).toBe(10000);
    expect(settlement.merchantEarnings).toBe(90000);
  });

  it('accounts for gateway fees', () => {
    const settlement = computeSettlement({
      ...order,
      processingFeeBasisPoints: 275,
      processingFeeFixed: 500,
    });
    expect(settlement.paymentProcessingFee).toBe(3800);
    expect(settlement.platformNet).toBe(120000 - 108000 - 3800);
  });

  it('balances: gross equals merchant plus fees plus platform', () => {
    const settlement = computeSettlement({
      ...order,
      tax: 6000,
      total: 126000,
      processingFeeBasisPoints: 275,
    });
    expect(
      settlement.merchantEarnings + settlement.paymentProcessingFee + settlement.platformNet,
    ).toBe(settlement.grossAmount);
  });
});

describe('computeRefundSplit', () => {
  it('splits a full refund back across both parties', () => {
    const settlement = computeSettlement({
      subtotal: 120000,
      discountTotal: 0,
      tax: 0,
      total: 120000,
      commissionBasisPoints: 1000,
    });

    const split = computeRefundSplit(settlement, 120000);
    expect(split.merchantClawback).toBe(108000);
    expect(split.platformClawback).toBe(12000);
  });

  it('splits a partial refund proportionally', () => {
    const settlement = computeSettlement({
      subtotal: 120000,
      discountTotal: 0,
      tax: 0,
      total: 120000,
      commissionBasisPoints: 1000,
    });

    const split = computeRefundSplit(settlement, 60000);
    expect(split.merchantClawback + split.platformClawback).toBe(60000);
  });
});

describe('assessCapacity', () => {
  it('quotes the base preparation time when the cafe has room', () => {
    const assessment = assessCapacity({
      maxConcurrentOrders: 10,
      activeOrderCount: 3,
      basePrepMinutes: 10,
    });
    expect(assessment.atCapacity).toBe(false);
    expect(assessment.effectiveLeadMinutes).toBe(10);
    expect(assessment.acceptsAsap).toBe(true);
  });

  it('stretches the estimate rather than refusing the order', () => {
    const assessment = assessCapacity({
      maxConcurrentOrders: 10,
      activeOrderCount: 10,
      basePrepMinutes: 10,
    });
    expect(assessment.atCapacity).toBe(true);
    expect(assessment.effectiveLeadMinutes).toBe(20);
    expect(assessment.acceptsAsap).toBe(false);
    expect(assessment.label).toContain('Busy');
  });

  it('stretches further as the backlog grows', () => {
    const assessment = assessCapacity({
      maxConcurrentOrders: 10,
      activeOrderCount: 25,
      basePrepMinutes: 10,
    });
    expect(assessment.effectiveLeadMinutes).toBe(30);
  });

  it('treats an unset ceiling as unlimited', () => {
    const assessment = assessCapacity({
      maxConcurrentOrders: null,
      activeOrderCount: 500,
      basePrepMinutes: 10,
    });
    expect(assessment.atCapacity).toBe(false);
  });
});

describe('estimateReadyMinutes', () => {
  it('uses the slowest item, not the sum', () => {
    expect(estimateReadyMinutes([3, 8, 4], 10)).toBe(9);
  });

  it('falls back to the cafe default when items have no estimate', () => {
    expect(estimateReadyMinutes([null, null], 12)).toBe(13);
  });

  it('caps an enormous order', () => {
    expect(estimateReadyMinutes(new Array(200).fill(5), 10)).toBe(60);
  });
});

describe('geo', () => {
  const clifton = { latitude: 24.8138, longitude: 67.0301 };
  const dha = { latitude: 24.7961, longitude: 67.0636 };

  it('measures a plausible distance across Karachi', () => {
    const meters = haversineMeters(clifton, dha);
    expect(meters).toBeGreaterThan(3000);
    expect(meters).toBeLessThan(5000);
  });

  it('is zero for the same point', () => {
    expect(haversineMeters(clifton, clifton)).toBe(0);
  });

  it('formats short and long distances differently', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(2340)).toBe('2.3 km');
    expect(formatDistance(null)).toBe('');
  });

  it('builds a box that contains points inside the radius', () => {
    const box = boundingBox(clifton, 5000);
    expect(dha.latitude).toBeGreaterThan(box.minLat);
    expect(dha.latitude).toBeLessThan(box.maxLat);
    expect(dha.longitude).toBeGreaterThan(box.minLng);
    expect(dha.longitude).toBeLessThan(box.maxLng);
  });
});

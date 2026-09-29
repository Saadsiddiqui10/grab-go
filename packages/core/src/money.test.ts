import { describe, expect, it } from 'vitest';
import { allocate, clampDiscount, formatPKR, percentOf, percentageOf, sum, toPaisa } from './money';

describe('money', () => {
  it('formats whole rupees without decimals', () => {
    expect(formatPKR(65000)).toBe('Rs. 650');
    expect(formatPKR(0)).toBe('Rs. 0');
  });

  it('formats partial rupees with two decimals', () => {
    expect(formatPKR(65050)).toBe('Rs. 650.50');
    expect(formatPKR(65005)).toBe('Rs. 650.05');
  });

  it('groups thousands', () => {
    expect(formatPKR(toPaisa(1234567))).toBe('Rs. 1,234,567');
  });

  it('formats negatives for refunds', () => {
    expect(formatPKR(-65000)).toBe('-Rs. 650');
  });

  it('computes basis points', () => {
    expect(percentageOf(65000, 1000)).toBe(6500);
    expect(percentageOf(65000, 0)).toBe(0);
  });

  it('rounds half away from zero symmetrically', () => {
    // A refund must be the exact inverse of the charge it reverses.
    expect(percentOf(15, 50)).toBe(8);
    expect(percentOf(-15, 50)).toBe(-8);
  });

  it('never lets a discount exceed the amount owed', () => {
    expect(clampDiscount(90000, 65000)).toBe(65000);
    expect(clampDiscount(-500, 65000)).toBe(0);
  });

  it('sums an empty basket to zero', () => {
    expect(sum([])).toBe(0);
  });

  describe('allocate', () => {
    it('splits without losing or inventing paisa', () => {
      const parts = allocate(100, [1, 1, 1]);
      expect(parts).toEqual([34, 33, 33]);
      expect(sum(parts)).toBe(100);
    });

    it('weights proportionally', () => {
      const parts = allocate(10000, [65000, 35000]);
      expect(sum(parts)).toBe(10000);
      expect(parts[0]).toBe(6500);
    });

    it('handles zero weights by assigning everything to the first part', () => {
      expect(allocate(500, [0, 0])).toEqual([500, 0]);
    });

    it('returns nothing for no weights', () => {
      expect(allocate(500, [])).toEqual([]);
    });
  });
});

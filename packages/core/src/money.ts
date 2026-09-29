import { BASIS_POINTS_DENOMINATOR, type BasisPoints, type Paisa } from '@grabgo/types';

/**
 * Integer money arithmetic in paisa.
 *
 * All rounding is half-up on the absolute value, so Rs. 12.345 and Rs. -12.345 both
 * round away from zero by the same magnitude. That keeps a refund the exact inverse
 * of the charge it reverses, which matters when reconciling merchant payouts.
 */

export function isValidAmount(value: unknown): value is Paisa {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertAmount(value: number, label = 'amount'): Paisa {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer number of paisa, received ${value}`);
  }
  return value;
}

export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** `percentageOf(65000, 1000)` -> 6500 (10% of Rs. 650). */
export function percentageOf(amount: Paisa, basisPoints: BasisPoints): Paisa {
  return roundHalfUp((amount * basisPoints) / BASIS_POINTS_DENOMINATOR);
}

/** Percentage expressed as a human number (12.5 means 12.5%). */
export function percentOf(amount: Paisa, percent: number): Paisa {
  return roundHalfUp((amount * percent) / 100);
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError('clamp: min must be <= max');
  return Math.min(Math.max(value, min), max);
}

/** A discount can never exceed what is owed, nor go negative. */
export function clampDiscount(discount: Paisa, ceiling: Paisa): Paisa {
  return clamp(discount, 0, Math.max(0, ceiling));
}

export function sum(amounts: readonly Paisa[]): Paisa {
  return amounts.reduce<Paisa>((total, amount) => total + amount, 0);
}

export const toPaisa = (rupees: number): Paisa => roundHalfUp(rupees * 100);
export const toRupees = (paisa: Paisa): number => paisa / 100;

/**
 * Display formatting. Whole-rupee amounts drop the decimals, because "Rs. 650" is
 * how a Karachi menu prices a latte — "Rs. 650.00" reads like an invoice.
 */
export function formatPKR(
  paisa: Paisa,
  options: { withDecimals?: boolean; withSymbol?: boolean } = {},
): string {
  const { withDecimals = paisa % 100 !== 0, withSymbol = true } = options;
  const negative = paisa < 0;
  const absolute = Math.abs(paisa);
  const rupees = Math.floor(absolute / 100);
  const remainder = absolute % 100;

  const grouped = rupees.toLocaleString('en-PK');
  const body = withDecimals ? `${grouped}.${String(remainder).padStart(2, '0')}` : grouped;

  return `${negative ? '-' : ''}${withSymbol ? 'Rs. ' : ''}${body}`;
}

/**
 * Split `amount` across `weights` so the parts sum back to exactly `amount`.
 *
 * Used when a basket-level discount has to be pushed down onto individual lines
 * for the merchant statement: naive per-line rounding loses or invents a paisa,
 * so the largest remainders absorb the difference.
 */
export function allocate(amount: Paisa, weights: readonly number[]): Paisa[] {
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  if (weights.length === 0) return [];
  if (totalWeight <= 0) {
    const parts = new Array<Paisa>(weights.length).fill(0);
    parts[0] = amount;
    return parts;
  }

  const exact = weights.map((weight) => (amount * weight) / totalWeight);
  const floored = exact.map((value) => Math.floor(value));
  let remainder = amount - floored.reduce((total, value) => total + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const { index } of order) {
    if (remainder <= 0) break;
    floored[index] = (floored[index] ?? 0) + 1;
    remainder -= 1;
  }

  return floored;
}

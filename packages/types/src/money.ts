/**
 * Money handling.
 *
 * Every monetary value that crosses a boundary (DB column, API field, client prop)
 * is an integer number of **paisa** (1 PKR = 100 paisa). Floats are never used for
 * money: `0.1 + 0.2 !== 0.3` is not an acceptable failure mode for an order total.
 */

/** An integer amount in paisa. Rs. 650.00 is `65000`. */
export type Paisa = number;

/** ISO-4217 currency code. The platform is single-currency at launch. */
export type CurrencyCode = 'PKR';

export const DEFAULT_CURRENCY: CurrencyCode = 'PKR';

/** Basis points (1/100th of a percent). 5% commission is `500`. */
export type BasisPoints = number;

export const BASIS_POINTS_DENOMINATOR = 10_000;

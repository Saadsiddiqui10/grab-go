import type { BasisPoints, Paisa } from '@grabgo/types';
import { percentageOf } from './money';

/**
 * Order economics.
 *
 * Recorded on every order from day one even though payouts are not part of the
 * MVP: reconstructing historical commission after the fact is guesswork, and
 * merchants will ask. The numbers are stored, not just derived, so a later change
 * to the commission rate cannot rewrite what a cafe already earned.
 */

export interface SettlementInput {
  subtotal: Paisa;
  discountTotal: Paisa;
  tax: Paisa;
  total: Paisa;
  commissionBasisPoints: BasisPoints;
  /** Gateway percentage fee, e.g. 275 for 2.75%. */
  processingFeeBasisPoints?: BasisPoints;
  /** Gateway flat fee per transaction. */
  processingFeeFixed?: Paisa;
  /**
   * Who pays for the discount. Platform-funded promos (WELCOME50) must not come
   * out of the cafe's pocket; a cafe's own happy-hour deal must.
   */
  discountFundedBy?: 'PLATFORM' | 'MERCHANT';
}

export interface Settlement {
  /** What the customer paid. */
  grossAmount: Paisa;
  /** Merchant-side revenue base, before commission. */
  netMerchandise: Paisa;
  platformCommission: Paisa;
  paymentProcessingFee: Paisa;
  merchantEarnings: Paisa;
  /** Platform revenue after it funds its own discounts and pays the gateway. */
  platformNet: Paisa;
}

export function computeSettlement(input: SettlementInput): Settlement {
  const fundedBy = input.discountFundedBy ?? 'PLATFORM';

  // Commission is charged on merchandise, never on tax the government takes.
  const merchantBase =
    fundedBy === 'MERCHANT'
      ? Math.max(0, input.subtotal - input.discountTotal)
      : input.subtotal;

  const platformCommission = percentageOf(merchantBase, input.commissionBasisPoints);

  const paymentProcessingFee =
    percentageOf(input.total, input.processingFeeBasisPoints ?? 0) +
    (input.processingFeeFixed ?? 0);

  const merchantEarnings = merchantBase - platformCommission + input.tax;
  const platformNet = input.total - merchantEarnings - paymentProcessingFee;

  return {
    grossAmount: input.total,
    netMerchandise: merchantBase,
    platformCommission,
    paymentProcessingFee,
    merchantEarnings,
    platformNet,
  };
}

/** Proportional refund figures for a partial or full refund. */
export function computeRefundSplit(
  settlement: Settlement,
  refundAmount: Paisa,
): { merchantClawback: Paisa; platformClawback: Paisa } {
  if (settlement.grossAmount <= 0) {
    return { merchantClawback: 0, platformClawback: 0 };
  }

  const ratio = Math.min(1, refundAmount / settlement.grossAmount);
  const merchantClawback = Math.round(settlement.merchantEarnings * ratio);

  return {
    merchantClawback,
    platformClawback: refundAmount - merchantClawback,
  };
}

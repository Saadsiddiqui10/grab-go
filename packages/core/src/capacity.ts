/**
 * Order capacity.
 *
 * A partner cafe with two baristas cannot absorb thirty simultaneous mobile
 * orders, and an app that lets customers queue past what the kitchen can produce
 * turns "skip the line" into a broken promise. Capacity does not reject demand —
 * it pushes the quoted pickup time out until it is honest.
 */

export interface CapacityInput {
  /** Cafe-configured ceiling on concurrent in-flight orders. Null = unlimited. */
  maxConcurrentOrders: number | null;
  /** Orders currently between ACCEPTED and READY. */
  activeOrderCount: number;
  /** The cafe's baseline preparation estimate, in minutes. */
  basePrepMinutes: number;
  /** Ceiling on orders promised for the same pickup slot. Null = unlimited. */
  maxOrdersPerSlot?: number | null;
}

export interface CapacityAssessment {
  atCapacity: boolean;
  /** Lead time to quote, stretched when the cafe is backed up. */
  effectiveLeadMinutes: number;
  /** Minutes until the cafe should free up. Null when it is not busy. */
  busyForMinutes: number | null;
  /** Whether an ASAP order can still be taken. */
  acceptsAsap: boolean;
  label: string | null;
}

export function assessCapacity(input: CapacityInput): CapacityAssessment {
  const basePrep = Math.max(1, input.basePrepMinutes);
  const ceiling = input.maxConcurrentOrders;

  if (ceiling === null || ceiling <= 0 || input.activeOrderCount < ceiling) {
    return {
      atCapacity: false,
      effectiveLeadMinutes: basePrep,
      busyForMinutes: null,
      acceptsAsap: true,
      label: null,
    };
  }

  // Every full batch beyond the ceiling adds another preparation cycle before a
  // new order could realistically start.
  const overflowBatches = Math.floor(input.activeOrderCount / ceiling);
  const effectiveLeadMinutes = basePrep * (overflowBatches + 1);

  return {
    atCapacity: true,
    effectiveLeadMinutes,
    busyForMinutes: effectiveLeadMinutes - basePrep,
    acceptsAsap: false,
    label: `Busy right now — about ${effectiveLeadMinutes} min`,
  };
}

/** Pickup slots the cafe has already promised to capacity. */
export function fullSlots(
  ordersPerSlot: ReadonlyMap<string, number>,
  maxOrdersPerSlot: number | null,
): string[] {
  if (maxOrdersPerSlot === null || maxOrdersPerSlot <= 0) return [];

  const full: string[] = [];
  for (const [slot, count] of ordersPerSlot) {
    if (count >= maxOrdersPerSlot) full.push(slot);
  }
  return full;
}

/**
 * Estimated ready time for a newly accepted order.
 *
 * Uses the cafe's own per-item preparation estimates when they exist, falling
 * back to the business default. Capped so a large order does not quote an
 * absurd wait.
 */
export function estimateReadyMinutes(
  itemPrepMinutes: readonly (number | null)[],
  basePrepMinutes: number,
  options: { maxMinutes?: number } = {},
): number {
  const { maxMinutes = 60 } = options;
  const known = itemPrepMinutes.filter((value): value is number => typeof value === 'number');

  // Drinks are made in parallel, so the slowest item sets the pace; each extra
  // item adds a little, not its full preparation time.
  const slowest = known.length > 0 ? Math.max(...known) : basePrepMinutes;
  const extras = Math.max(0, itemPrepMinutes.length - 1);

  return Math.min(maxMinutes, Math.max(1, Math.round(slowest + extras * 0.5)));
}

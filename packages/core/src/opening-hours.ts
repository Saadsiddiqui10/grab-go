import type { PickupSlot } from '@grabgo/types';
import {
  addMinutes,
  ceilToInterval,
  dateKeyIn,
  dayOfWeekIn,
  formatMinutesOfDay,
  formatTimeIn,
  minutesOfDay,
  startOfZonedDay,
  zonedTimeToUtc,
  getZonedParts,
} from './time';

/**
 * Opening hours and pickup-slot generation.
 *
 * Two things make this less trivial than it looks: cafes that close after midnight
 * (a 08:00-01:00 row belongs to two calendar days), and holidays that override the
 * weekly pattern for a single date.
 */

export interface WeeklyHour {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Minutes since local midnight. Null when closed. */
  opensAt: number | null;
  closesAt: number | null;
  isClosed: boolean;
}

export interface HolidayHour {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  isClosed: boolean;
  opensAt: number | null;
  closesAt: number | null;
}

export interface ScheduleContext {
  timeZone: string;
  weekly: readonly WeeklyHour[];
  holidays?: readonly HolidayHour[];
  /** Set while the merchant has flipped the "pause orders" switch. */
  temporarilyClosed?: boolean;
}

interface ResolvedWindow {
  opensAt: number;
  closesAt: number;
  /** True when the window runs past midnight into the next calendar day. */
  overnight: boolean;
}

function windowForDate(
  context: ScheduleContext,
  reference: Date,
  dayOffset: number,
): ResolvedWindow | null {
  const dayStart = startOfZonedDay(reference, context.timeZone, dayOffset);
  const key = dateKeyIn(dayStart, context.timeZone);

  const holiday = context.holidays?.find((entry) => entry.date === key);
  if (holiday) {
    if (holiday.isClosed || holiday.opensAt === null || holiday.closesAt === null) {
      return null;
    }
    return {
      opensAt: holiday.opensAt,
      closesAt: holiday.closesAt,
      overnight: holiday.closesAt <= holiday.opensAt,
    };
  }

  const weekday = dayOfWeekIn(dayStart, context.timeZone);
  const row = context.weekly.find((entry) => entry.dayOfWeek === weekday);
  if (!row || row.isClosed || row.opensAt === null || row.closesAt === null) return null;

  return {
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    overnight: row.closesAt <= row.opensAt,
  };
}

/** Is the business open at `instant`? */
export function isOpenAt(context: ScheduleContext, instant: Date): boolean {
  if (context.temporarilyClosed) return false;

  const minutes = minutesOfDay(instant, context.timeZone);

  const today = windowForDate(context, instant, 0);
  if (today) {
    if (today.overnight) {
      if (minutes >= today.opensAt) return true;
    } else if (minutes >= today.opensAt && minutes < today.closesAt) {
      return true;
    }
  }

  // The tail of yesterday's overnight window (e.g. open until 01:00).
  const yesterday = windowForDate(context, instant, -1);
  if (yesterday?.overnight && minutes < yesterday.closesAt) return true;

  return false;
}

/**
 * The instant the current open window ends, or null when closed.
 * Used to stop generating pickup slots past closing time.
 */
export function closingTimeAfter(context: ScheduleContext, instant: Date): Date | null {
  const minutes = minutesOfDay(instant, context.timeZone);

  const today = windowForDate(context, instant, 0);
  if (today) {
    if (today.overnight && minutes >= today.opensAt) {
      return instantAtLocalMinutes(context.timeZone, instant, 1, today.closesAt);
    }
    if (!today.overnight && minutes >= today.opensAt && minutes < today.closesAt) {
      return instantAtLocalMinutes(context.timeZone, instant, 0, today.closesAt);
    }
  }

  const yesterday = windowForDate(context, instant, -1);
  if (yesterday?.overnight && minutes < yesterday.closesAt) {
    return instantAtLocalMinutes(context.timeZone, instant, 0, yesterday.closesAt);
  }

  return null;
}

function instantAtLocalMinutes(
  timeZone: string,
  reference: Date,
  dayOffset: number,
  minutes: number,
): Date {
  const dayStart = startOfZonedDay(reference, timeZone, dayOffset);
  const { year, month, day } = getZonedParts(dayStart, timeZone);
  return zonedTimeToUtc(
    timeZone,
    year,
    month,
    day,
    Math.floor(minutes / 60),
    minutes % 60,
  );
}

/** The next instant the business opens, searching up to `horizonDays` ahead. */
export function nextOpeningTime(
  context: ScheduleContext,
  from: Date,
  horizonDays = 7,
): Date | null {
  if (context.temporarilyClosed) return null;

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const window = windowForDate(context, from, offset);
    if (!window) continue;

    const opensAt = instantAtLocalMinutes(context.timeZone, from, offset, window.opensAt);
    if (opensAt.getTime() > from.getTime()) return opensAt;
  }

  return null;
}

/** Human summary for the cafe page, e.g. "Open until 11:00 PM". */
export function describeAvailability(
  context: ScheduleContext,
  now: Date,
): { isOpen: boolean; label: string } {
  if (context.temporarilyClosed) {
    return { isOpen: false, label: 'Temporarily closed' };
  }

  if (isOpenAt(context, now)) {
    const closesAt = closingTimeAfter(context, now);
    return {
      isOpen: true,
      label: closesAt
        ? `Open until ${formatTimeIn(closesAt, context.timeZone)}`
        : 'Open now',
    };
  }

  const opensAt = nextOpeningTime(context, now);
  if (!opensAt) return { isOpen: false, label: 'Closed' };

  const sameDay = dateKeyIn(opensAt, context.timeZone) === dateKeyIn(now, context.timeZone);
  const time = formatTimeIn(opensAt, context.timeZone);
  return { isOpen: false, label: sameDay ? `Opens at ${time}` : `Opens ${time} tomorrow` };
}

/* ---------------------------------------------------------------- pickup slots */

export interface PickupSlotOptions {
  now: Date;
  schedule: ScheduleContext;
  /** Minutes the cafe needs before the earliest possible pickup. */
  leadTimeMinutes: number;
  /** Slot granularity, e.g. 15 for :00/:15/:30/:45. */
  intervalMinutes: number;
  /** How far ahead scheduling is allowed. */
  maxAheadMinutes: number;
  /** Slots the cafe has already filled to capacity. ISO strings. */
  unavailableSlots?: readonly string[];
  /** Cap on how many slots to return, so the picker stays scrollable. */
  maxSlots?: number;
  /** Suppress the ASAP entry (e.g. the cafe is at its concurrent-order ceiling). */
  allowAsap?: boolean;
}

/**
 * Build the pickup-time picker.
 *
 * A slot only appears if the cafe is open at that moment, it clears the lead time,
 * and the window is still open when the order would be handed over. That is what
 * makes "only show valid times" true rather than aspirational.
 */
export function generatePickupSlots(options: PickupSlotOptions): PickupSlot[] {
  const {
    now,
    schedule,
    leadTimeMinutes,
    intervalMinutes,
    maxAheadMinutes,
    unavailableSlots = [],
    maxSlots = 32,
    allowAsap = true,
  } = options;

  const blocked = new Set(unavailableSlots);
  const slots: PickupSlot[] = [];
  const earliest = addMinutes(now, Math.max(0, leadTimeMinutes));
  const horizon = addMinutes(now, Math.max(0, maxAheadMinutes));

  const openNow = isOpenAt(schedule, now);

  if (openNow && allowAsap && isOpenAt(schedule, earliest)) {
    slots.push({
      time: earliest.toISOString(),
      label: `ASAP (~${Math.max(1, Math.round(leadTimeMinutes))} min)`,
      available: true,
      isAsap: true,
    });
  }

  let cursor = ceilToInterval(earliest, intervalMinutes);
  // Never offer a scheduled slot that is the same minute as ASAP.
  if (cursor.getTime() <= earliest.getTime()) {
    cursor = addMinutes(cursor, intervalMinutes);
  }

  let guard = 0;
  const maxIterations = Math.ceil(maxAheadMinutes / Math.max(1, intervalMinutes)) + 2;

  while (
    cursor.getTime() <= horizon.getTime() &&
    slots.length < maxSlots &&
    guard < maxIterations
  ) {
    guard += 1;

    if (isOpenAt(schedule, cursor)) {
      const iso = cursor.toISOString();
      slots.push({
        time: iso,
        label: formatMinutesOfDay(minutesOfDay(cursor, schedule.timeZone)),
        available: !blocked.has(iso),
        isAsap: false,
      });
      cursor = addMinutes(cursor, intervalMinutes);
      continue;
    }

    // Closed at the cursor: jump straight to the next opening rather than
    // stepping through the night one interval at a time.
    const nextOpen = nextOpeningTime(schedule, cursor);
    if (!nextOpen || nextOpen.getTime() > horizon.getTime()) break;
    cursor = ceilToInterval(nextOpen, intervalMinutes);
  }

  return slots;
}

/** Validate a customer-supplied pickup time against the slots we would have offered. */
export function isValidPickupTime(
  requested: Date,
  options: PickupSlotOptions,
): boolean {
  const earliest = addMinutes(options.now, Math.max(0, options.leadTimeMinutes));
  const horizon = addMinutes(options.now, Math.max(0, options.maxAheadMinutes));

  // A minute of slack absorbs clock skew between the phone and the server.
  const tolerance = 60_000;

  if (requested.getTime() < earliest.getTime() - tolerance) return false;
  if (requested.getTime() > horizon.getTime() + tolerance) return false;

  return isOpenAt(options.schedule, requested);
}
